# Framewise - Agentic Video Analysis Agent

**Turn client screen recordings into reviewed GitHub issues, with timestamps and visual evidence.**

Clients often send feedback as a video: a requested copy change, a broken menu, a vague reaction, and the same bug mentioned twice. Someone still has to watch it, work out what needs doing, and write the tickets.

Framewise handles that first pass. It uses Gemini to analyze what the client says and what appears on screen, groups repeated feedback, and drafts work for a person to review. It creates GitHub issues only after explicit approval. Questions and unclear feedback do not become tickets automatically.

## What it does

1. **Analyze a recording.** Read spoken feedback and visible behavior alongside a short project context file.
2. **Sort the feedback.** Separate clear requests, possible bugs, vague reactions, and questions. Merge repeated mentions of the same problem.
3. **Attach evidence.** Keep timestamps and extract screenshots so the reviewer can check the relevant moment.
4. **Ask for review.** Let a person confirm, edit, approve, or decline proposed work.
5. **Publish approved issues.** Check for existing issues before writing, and save a local record of the analysis and decisions.

There is a command-line workflow and a local browser interface for uploading recordings, inspecting the timeline, and reviewing proposed issues.

### Not every comment is a task

| Feedback | Framewise's response |
|---|---|
| “Change the hero button label.” | Draft a proposed issue for approval. |
| “The mobile menu covers the logo.” | Draft a bug issue with evidence. |
| The same menu bug mentioned later | Merge both mentions into one proposed issue. |
| “Something feels off about pricing.” | Ask for clarification, rather than invent a change. |
| “Are we tracking analytics here?” | Keep it as a question, not a change request. |
| A visible form anomaly with no spoken request | Require manual confirmation before approval. |

## Results from the demo

The test recording contained six cases with expected outcomes defined before analysis. Three separate live Gemini analyses passed the six-case evaluation. The final run merged the repeated bug and produced two clear proposals, one manual-review finding, one clarification request, and one withheld question.

| Measurement | Recorded result |
|---|---|
| Approved GitHub issues created | 3 |
| Manual watching and issue writing | 18 min 52 sec |
| Active human time using Framewise | 4 min 6 sec |
| Final workflow time, including model wait and review | 5 min 20 sec |

These are measurements from **one synthetic recording**, not a general accuracy or productivity benchmark. The [evaluation report](docs/submission/proof-bundle/deterministic-report.json) and [sanitized run record](docs/submission/proof-bundle/ledger.json) contain the supporting data.

## How it is built

```text
Screen recording + project context
                |
       Gemini video analysis
                |
   Response validation + feedback rules
                |
   Timestamped evidence + human review
                |
       Approved GitHub issues
```

**Stack:** Python 3.14, Gemini Interactions API (`gemini-3.5-flash-lite`), Pydantic, FFmpeg/FFprobe, FastAPI, Uvicorn, and Docker. Tests use pytest, mypy, and Playwright.

The model interprets the recording; Python code controls what can happen next. Both the CLI and browser interface use the same analysis, review, and publishing logic. State lives in local JSON files, with no hosted service or database required.

### Engineering decisions

- **Trust completed results, not partial output.** The workflow saves the Gemini interaction ID and retrieves the completed response before accepting its structured output.
- **Validate video timestamps.** Strict clock strings are converted to elapsed seconds and checked against the actual recording duration. Invalid times are rejected rather than guessed.
- **Bind approval to the exact issue.** Approval records the proposed content and destination. Changed proposals need fresh approval.
- **Handle uncertain writes conservatively.** Publishing searches open and closed issues for a stable recording-and-finding marker. If a create request has an uncertain outcome, it stops rather than retrying automatically.
- **Keep a recoverable history.** An atomically written run record stores analysis attempts, evidence, approvals, and publishing outcomes. Changed prompts or policies cannot silently reuse outdated results.

The tests cover validation, feedback routing, duplicate merging, approval, recovery, and GitHub write handling, with separate browser and container checks. Live-model evidence is kept separately from tests that use fake services.

## Run locally

You need Docker and an exported `GEMINI_API_KEY` to analyze recordings. Publishing also needs an exported `GITHUB_TOKEN` with access to the destination repository.

From the repository root:

```bash
docker build -t client-feedback-triage .
mkdir -p inbox output
```

Put a recording in `inbox/`. The browser also supports uploads. Review `CONTEXT.md` so it describes the project shown in your recording.

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  --env GEMINI_API_KEY --env GITHUB_TOKEN --env GITHUB_REPOSITORY \
  --publish 127.0.0.1:8000:8000 \
  --mount type=bind,src="$PWD/inbox",dst=/input,readonly \
  --mount type=bind,src="$PWD/CONTEXT.md",dst=/context/CONTEXT.md,readonly \
  --mount type=bind,src="$PWD/output",dst=/output \
  client-feedback-triage web --host 0.0.0.0 --port 8000
```

Open **http://127.0.0.1:8000**. Set `GITHUB_REPOSITORY` to `owner/repository` if you intend to publish. Analysis and publishing use external APIs and may incur usage charges.

The Docker image and Python package still use the internal name `client-feedback-triage`. See the [usage guide](docs/usage.md) for analysis-only CLI commands, review and publishing, the three-run acceptance cycle, and recovery options.

### Development checks

Docker is the supported runtime. If Python 3.14 and FFmpeg are already installed locally:

```bash
uv sync
uv run python -m mypy feedback_triage main.py tests
uv run python -m pytest
```

Browser tests skip if Playwright or Chromium is unavailable; the container smoke test skips if Docker is unavailable. See the [usage guide](docs/usage.md#development-checks) for those checks.
