"""Analyze one public YouTube recording and write the static replay payload for the hosted demo.

Usage:
    uv run python scripts/build-demo.py --youtube URL --duration SECONDS --title TITLE [--context CONTEXT.md]

--duration is the operator-read length of the YouTube video. It is the trusted duration that policy
checks Gemini's evidence timestamps against, the role FFprobe plays for local files.
The verified analysis is cached under output/demo/, so rerunning only rebuilds the payload;
pass --reanalyze to spend a new Gemini request.
"""

import argparse
import json
import sys
import time
from pathlib import Path

from feedback_triage.demo import build_demo, canonical_youtube_url, youtube_id, youtube_source_sha256
from feedback_triage.gemini_video import PROMPT, analyze_video_url, create_client
from feedback_triage.models import UrlVideoAnalysis
from feedback_triage.policy import PolicyFailure, route_analysis

ROOT = Path(__file__).resolve().parent.parent
PROOF_ISSUES = [f"https://github.com/heykay-47/crework-feedback-demo/issues/{number}" for number in (4, 5, 6)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--youtube", required=True)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--title", required=True)
    parser.add_argument("--context", type=Path, default=ROOT / "CONTEXT.md")
    parser.add_argument("--out", type=Path, default=ROOT / "site" / "demo.json")
    parser.add_argument("--reanalyze", action="store_true")
    args = parser.parse_args()
    if args.duration <= 0:
        parser.error("--duration must be positive")

    video_id = youtube_id(args.youtube)
    project_context = args.context.read_text(encoding="utf-8")
    cache = ROOT / "output" / "demo" / f"{video_id}.json"
    if cache.exists() and not args.reanalyze:
        cached = json.loads(cache.read_text(encoding="utf-8"))
        if cached["project_context"] != project_context or cached.get("prompt") != PROMPT:
            parser.error(f"{cache} was analyzed with a different prompt or context; pass --reanalyze")
        verified = UrlVideoAnalysis.model_validate(cached["verified"])
        timings: dict[str, float] = cached["timings"]
        print(f"Reusing verified analysis from {cache}")
    else:
        print("Gemini is analyzing the video...")
        started = time.monotonic()
        verified = analyze_video_url(create_client(), canonical_youtube_url(video_id), project_context=project_context)
        timings = {"analysis_seconds": time.monotonic() - started}
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(
            json.dumps(
                {"prompt": PROMPT, "project_context": project_context, "verified": verified.model_dump(mode="json"), "timings": timings},
                indent=2,
            ),
            encoding="utf-8",
        )

    try:
        policy = route_analysis(
            verified.analysis,
            duration_seconds=args.duration,
            source_sha256=youtube_source_sha256(video_id),
        )
    except PolicyFailure as error:
        print(f"Policy rejected the analysis ({error.code}): {error}", file=sys.stderr)
        return 1

    demo = build_demo(
        video_id=video_id,
        title=args.title,
        duration_seconds=args.duration,
        project_context=project_context,
        verified=verified,
        policy=policy,
        timings=timings,
        proof_issue_urls=PROOF_ISSUES,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(demo, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    routes = [result.route for result in policy.results]
    print(f"Wrote {args.out}: {len(routes)} routed results {routes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
