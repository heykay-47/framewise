from types import SimpleNamespace
from typing import Any

import pytest

from feedback_triage.demo import build_demo, youtube_id, youtube_source_sha256
from feedback_triage.gemini_video import FilesAPI, InteractionAPI, ProcessingUnverified, UntrustedInteraction, analyze_video_url
from feedback_triage.models import UrlVideoAnalysis
from feedback_triage.policy import route_analysis
from tests.test_completion_trust import VALID_OUTPUT

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def video_usage(tokens: int) -> object:
    return SimpleNamespace(input_tokens_by_modality=[SimpleNamespace(modality="text", tokens=12), SimpleNamespace(modality="video", tokens=tokens)])


class NoUpload:
    def upload(self, *, file: str) -> object:
        raise AssertionError("a URL source must not be uploaded")

    def get(self, *, name: str) -> object:
        raise AssertionError("a URL source must not be polled")


class Interactions:
    def __init__(self, reply: object) -> None:
        self.reply = reply
        self.create_kwargs: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> Any:
        self.create_kwargs = kwargs
        return self.reply

    def get(self, *, id: str) -> object:
        raise AssertionError("a synchronous URL analysis must not be retrieved")


class Client:
    files: FilesAPI
    interactions: InteractionAPI

    def __init__(self, reply: object) -> None:
        self.files = NoUpload()
        self.recorded = Interactions(reply)
        self.interactions = self.recorded


def completed(**overrides: object) -> object:
    return SimpleNamespace(**({"status": "completed", "output_text": VALID_OUTPUT, "usage": video_usage(78720)} | overrides))


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/shorts/dQw4w9WgXcQ",
    ],
)
def test_youtube_id_accepts_video_urls(url: str) -> None:
    assert youtube_id(url) == "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/playlist?list=PL123",
        "https://evil.example/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
        "https://youtu.be/short",
    ],
)
def test_youtube_id_rejects_everything_else(url: str) -> None:
    with pytest.raises(ValueError):
        youtube_id(url)


def test_url_is_sent_to_gemini_for_static_low_resolution_processing() -> None:
    client = Client(completed())

    result = analyze_video_url(client, URL, project_context="context")

    sent = client.recorded.create_kwargs
    assert sent is not None
    assert sent["input"][0] == {"type": "video", "uri": URL, "resolution": "low"}
    assert "context" in sent["input"][1]["text"]
    assert result.video_input_tokens == 78720
    assert result.analysis.schema_version == "1.0"


def test_result_without_counted_video_tokens_is_rejected() -> None:
    with pytest.raises(ProcessingUnverified):
        analyze_video_url(Client(completed(usage=video_usage(0))), URL)


def test_incomplete_interaction_is_rejected() -> None:
    with pytest.raises(UntrustedInteraction, match="status is failed"):
        analyze_video_url(Client(completed(status="failed")), URL)


def test_demo_payload_previews_issues_only_for_approvable_routes() -> None:
    verified: UrlVideoAnalysis = analyze_video_url(Client(completed()), URL)
    duration = 600.0
    policy = route_analysis(verified.analysis, duration_seconds=duration, source_sha256=youtube_source_sha256("dQw4w9WgXcQ"))

    demo = build_demo(
        video_id="dQw4w9WgXcQ",
        title="Demo",
        duration_seconds=duration,
        project_context="context",
        verified=verified,
        policy=policy,
        timings={"analysis_seconds": 1.234},
        proof_issue_urls=[],
    )

    results = demo["results"]
    assert isinstance(results, list) and results
    for result in results:
        approvable = result["route"] in {"candidate", "manual_review"}
        assert (result["issue_preview"] is not None) == approvable
    analysis = demo["analysis"]
    assert isinstance(analysis, dict)
    assert analysis["summary"] == verified.analysis.video_summary
    assert analysis["video_input_tokens"] == 78720
    assert analysis["timings"] == {"analysis_seconds": 1.23}
