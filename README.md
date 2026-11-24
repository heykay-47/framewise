# Framewise

**Turn client screen recordings into reviewed GitHub issues, with timestamps and visual evidence.**

Try the [live demo](https://framewise-triage.vercel.app). It replays a real Gemini analysis of a public team feedback call.

Clients often send feedback as a video: a requested copy change, a broken menu, a vague reaction, and the same bug mentioned twice. Someone still has to watch it, work out what needs doing, and write the tickets.

Framewise does that first pass. It uses Gemini to analyze what the client says and what appears on screen, groups repeated feedback, and drafts work for a person to review. It creates GitHub issues only after explicit approval. Questions and unclear feedback do not become tickets automatically.

## What it does

1. **Analyze a recording.** Read spoken feedback and visible behavior alongside a short project context file.
2. **Sort the feedback.** Separate clear requests, possible bugs, vague reactions, and questions. Merge repeated mentions of the same problem.
3. **Attach evidence.** Keep timestamps and extract screenshots so the reviewer can check the relevant moment.
4. **Ask for review.** Let a person confirm, edit, approve, or decline proposed work.
5. **Publish approved issues.** Check for existing issues before writing, and save a local record of the analysis and decisions.

You can use a command-line workflow or a local browser interface. The browser interface uploads recordings, shows the evidence timeline, and reviews proposed issues.

### Not every comment is a task

| Feedback | Framewise's response |
|---|---|
| "Change the hero button label." | Draft a proposed issue for approval. |
| "The mobile menu covers the logo." | Draft a bug issue with evidence. |
| The same menu bug mentioned later | Merge both mentions into one proposed issue. |
| "Something feels off about pricing." | Ask for clarification, rather than invent a change. |
| "Are we tracking analytics here?" | Keep it as a question, not a change request. |
| A visible form anomaly with no spoken request | Require manual confirmation before approval. |
| The presenter says "I removed the borders" | Withhold it, because the presenter is describing their own work. |

## Results from the acceptance recording

The acceptance recording contained six cases with expected outcomes defined before analysis. Three separate live Gemini analyses passed the six-case evaluation. The final run merged the repeated bug and produced two clear proposals, one manual-review finding, one clarification request, and one withheld question.

| Measurement | Recorded result |
|---|---|
| Approved GitHub issues created | 3 |
| Manual watching and issue writing | 18 min 52 sec |
| Active human time using Framewise | 4 min 6 sec |
| Final workflow time, including model wait and review | 5 min 20 sec |

These are measurements from **one synthetic recording**, not a general accuracy or productivity benchmark. The [evaluation report](docs/submission/proof-bundle/deterministic-report.json) and [sanitized run record](docs/submission/proof-bundle/ledger.json) contain the supporting data.

## How it is built

```text
Screen recording or public YouTube URL + project context
                |
       Gemini video analysis
                |
   Response validation + feedback rules
                |
   Timestamped evidence + human review
                |
       Approved GitHub issues
```

**Stack:** Python 3.14, Gemini Interactions API (`gemini-3.5-flash-lite`), Pydantic, FFmpeg and FFprobe, FastAPI, Uvicorn, and Docker. Tests use pytest, mypy, and Playwright. The hosted demo is a static page on Vercel.

The model interprets the recording, and Python code controls what can happen next. The CLI and the browser interface share the same analysis, review, and publishing logic. State lives in local JSON files, so no hosted service or database is required.

### Engineering decisions

- **Trust completed results, not partial output.** The workflow saves the Gemini interaction ID and retrieves the completed response before accepting its structured output.
- **Validate video timestamps.** Strict clock strings are converted to elapsed seconds and checked against the recording's duration. Invalid times are rejected rather than guessed.
- **Bind approval to the exact issue.** Approval records the proposed content and destination. Changed proposals need fresh approval.
- **Handle uncertain writes conservatively.** Publishing searches open and closed issues for a stable recording-and-finding marker. If a create request has an uncertain outcome, it stops rather than retrying automatically.
- **Keep a recoverable history.** An atomically written run record stores analysis attempts, evidence, approvals, and publishing outcomes. Changed prompts or policies cannot reuse outdated results.
- **Use a separate proof for YouTube URLs.** Gemini fetches a public YouTube video itself, with static low-resolution processing, because agentic processing of YouTube URLs fails with a persistent 503. Static processing reports no processing steps. A URL result is accepted only when the interaction completed, the output matches the schema, and Gemini counted video input tokens.

The tests cover validation, feedback routing, duplicate merging, approval, recovery, GitHub write handling, and YouTube URL analysis, with separate browser and container checks. Live-model evidence is kept apart from tests that use fake services.

## Run locally

You need Docker and an exported `GEMINI_API_KEY` to analyze recordings. Publishing also needs an exported `GITHUB_TOKEN` with access to the destination repository.

Clone the repository and build the image:

```bash
git clone https://github.com/heykay-47/framewise.git
cd framewise
docker build -t client-feedback-triage .
mkdir -p inbox output
```

Put a recording in `inbox/`, or upload one in the browser. Edit `CONTEXT.md` so it describes the project shown in your recording.

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  --env GEMINI_API_KEY --env GITHUB_TOKEN --env GITHUB_REPOSITORY \
  --publish 127.0.0.1:8000:8000 \
  --mount type=bind,src="$PWD/inbox",dst=/input,readonly \
  --mount type=bind,src="$PWD/CONTEXT.md",dst=/context/CONTEXT.md,readonly \
  --mount type=bind,src="$PWD/output",dst=/output \
  client-feedback-triage web --host 0.0.0.0 --port 8000
```

Open **http://127.0.0.1:8000**. To publish, set `GITHUB_REPOSITORY` to `owner/repository`. Analysis and publishing use external APIs and may incur usage charges.

The Docker image and Python package still use the internal name `client-feedback-triage`. See the [usage guide](docs/usage.md) for analysis-only CLI commands, review and publishing, the three-run acceptance cycle, and recovery options.

## Hosted replay demo

The [live demo](https://framewise-triage.vercel.app) analyzes [UX Group Feedback: Threaded discussions](https://www.youtube.com/watch?v=3swiyH_au6c), a public GitLab design review. It found two teammate requests to propose as issues and withheld one comment. Visitors can play the video, jump to each piece of evidence, and approve a proposal to see the exact issue Framewise would create.

`site/` is the static page behind it. It has no backend, database, or hosted keys, and publishing is disabled. Gemini reads the YouTube URL directly, so the video is never downloaded or uploaded.

To rebuild the page data, export `GEMINI_API_KEY` and run:

```bash
uv run python scripts/build-demo.py \
  --youtube "https://www.youtube.com/watch?v=3swiyH_au6c" \
  --duration 865 --title "UX Group Feedback: Threaded discussions (GitLab Unfiltered)" \
  --context docs/demo-context.md
```

`--duration` is the video length in seconds as shown on YouTube. Policy checks Gemini's timestamps against it, the job FFprobe does for local files. `--context` describes the product shown in the recording. The script caches the verified analysis in `output/demo/` and reuses it while the prompt and context are unchanged. Pass `--reanalyze` to call Gemini again. The script writes `site/demo.json`.

To deploy, create a Vercel project from this repository with **Root Directory** set to `site`, or run `npx vercel deploy --prod` from `site/`. Use a Gemini key from a project with no billing account attached, so requests over the free quota fail instead of being charged.

## Development checks

Docker is the supported runtime. If Python 3.14 and FFmpeg are already installed locally, run:

```bash
uv sync
uv run python -m mypy feedback_triage main.py tests scripts/build-demo.py
uv run python -m pytest
```

Browser tests skip if Playwright or Chromium is unavailable. The container smoke test skips if Docker is unavailable. See the [usage guide](docs/usage.md#development-checks) for those checks.
