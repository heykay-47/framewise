"""Static replay payload for the hosted demo: one verified analysis of a public YouTube recording."""

import hashlib
import re
from urllib.parse import parse_qs, urlparse

from feedback_triage.approval import render_issue_payload
from feedback_triage.gemini_video import MODEL
from feedback_triage.models import PolicyResult, UrlVideoAnalysis
from feedback_triage.web import ROUTE_DEFINITIONS_BY_KEY

_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def youtube_id(url: str) -> str:
    """Return the 11-character video ID of a YouTube watch, youtu.be, shorts, or live URL."""

    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").removeprefix("www.").removeprefix("m.")
    candidate = ""
    if host == "youtu.be":
        candidate = parsed.path.strip("/")
    elif host == "youtube.com":
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [""])[0]
        else:
            parts = parsed.path.strip("/").split("/")
            if len(parts) == 2 and parts[0] in {"shorts", "live", "embed"}:
                candidate = parts[1]
    if parsed.scheme not in {"http", "https"} or not _VIDEO_ID.fullmatch(candidate):
        raise ValueError(f"not a YouTube video URL: {url!r}")
    return candidate


def canonical_youtube_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def youtube_source_sha256(video_id: str) -> str:
    """Stable source identity for a recording Gemini fetches by URL rather than by bytes."""

    return hashlib.sha256(canonical_youtube_url(video_id).encode()).hexdigest()


def build_demo(
    *,
    video_id: str,
    title: str,
    duration_seconds: float,
    project_context: str,
    verified: UrlVideoAnalysis,
    policy: PolicyResult,
    timings: dict[str, float],
    proof_issue_urls: list[str],
) -> dict[str, object]:
    source_sha256 = youtube_source_sha256(video_id)
    results: list[dict[str, object]] = []
    for result in policy.results:
        definition = ROUTE_DEFINITIONS_BY_KEY[result.route]
        preview = render_issue_payload(result, source_sha256) if definition.approval_eligible else None
        results.append(
            {
                **result.model_dump(mode="json"),
                "route_label": definition.label,
                "route_description": definition.description,
                "issue_preview": preview.model_dump(mode="json") if preview is not None else None,
            }
        )
    return {
        "schema_version": "1",
        "video": {
            "youtube_id": video_id,
            "url": canonical_youtube_url(video_id),
            "title": title,
            "duration_seconds": duration_seconds,
        },
        "project_context": project_context,
        "analysis": {
            "model": MODEL,
            "summary": verified.analysis.video_summary,
            "video_input_tokens": verified.video_input_tokens,
            "usage": verified.gemini_usage,
            "timings": {name: round(seconds, 2) for name, seconds in timings.items()},
        },
        "results": results,
        "proof_issue_urls": proof_issue_urls,
    }
