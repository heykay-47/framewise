"use strict";

const ROUTES = {
  candidate: { label: "Candidate", order: 0 },
  manual_review: { label: "Manual review", order: 1 },
  clarification_request: { label: "Clarification request", order: 2 },
  withheld_result: { label: "Withheld result", order: 3 },
};
const ROUTE_NO_APPROVAL = {
  clarification_request: "Framewise does not propose this as work yet. The request is too ambiguous, so it asks the client the clarification question instead.",
  withheld_result: "Framewise keeps this in the run ledger but excludes it from approval because it is non-actionable or low confidence.",
};

const state = { data: null, results: [], selected: -1, approved: new Set(), confirmed: new Set(), player: null, playerReady: false };
const $ = (id) => document.getElementById(id);

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children || [])) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const str = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");
const arr = (value) => (Array.isArray(value) ? value : []);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const routeKey = (result) => (ROUTES[result.route] ? result.route : "withheld_result");
const routeLabel = (result) => str(result.route_label) || ROUTES[routeKey(result)].label;

function timecode(seconds) {
  const total = Math.max(0, Math.floor(num(seconds) || 0));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function firstSecond(result) {
  const starts = arr(result.evidence).map((item) => num(item && item.start_seconds)).filter((value) => value !== null);
  if (starts.length) return Math.min(...starts);
  return num(result.evidence_frame_seconds);
}

function duration() {
  const declared = num(state.data.video && state.data.video.duration_seconds);
  if (declared && declared > 0) return declared;
  const ends = state.results.flatMap((r) => arr(r.evidence).map((e) => num(e && e.end_seconds) || num(e && e.start_seconds) || 0));
  return Math.max(1, ...ends);
}

/* ---------- Player ---------- */

function youtubeId() {
  const id = str(state.data.video && state.data.video.youtube_id);
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : "";
}

function embedUrl(start, autoplay) {
  const params = new URLSearchParams({ enablejsapi: "1", rel: "0", playsinline: "1", origin: location.origin });
  if (start) params.set("start", String(Math.floor(start)));
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${youtubeId()}?${params}`;
}

function setupPlayer() {
  const stage = $("video-stage");
  if (!youtubeId()) {
    stage.append(el("p", { class: "video-placeholder", text: "The source recording is unavailable." }));
    return;
  }
  const title = str(state.data.video.title) || "Client feedback recording";
  stage.append(el("iframe", {
    id: "player",
    src: embedUrl(0, false),
    title: `Source recording: ${title}`,
    allow: "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture",
    allowfullscreen: true,
    referrerpolicy: "strict-origin-when-cross-origin",
  }));
  window.onYouTubeIframeAPIReady = () => {
    try {
      state.player = new window.YT.Player("player", { events: { onReady: () => { state.playerReady = true; } } });
    } catch (error) {
      state.player = null;
    }
  };
  document.head.append(el("script", { src: "https://www.youtube.com/iframe_api", async: true }));
}

function seek(seconds) {
  const at = num(seconds);
  if (at === null) return;
  if (state.playerReady && state.player && typeof state.player.seekTo === "function") {
    state.player.seekTo(at, true);
    state.player.playVideo();
  } else {
    const frame = $("player");
    if (frame) frame.src = embedUrl(at, true);
  }
  const stage = $("video-stage");
  if (stage && stage.getBoundingClientRect().top < 0) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
}

function jumpTo(index, seconds) {
  select(index);
  seek(seconds);
}

/* ---------- Header sections ---------- */

function renderVideoMeta() {
  const video = state.data.video || {};
  $("video-heading").textContent = str(video.title) || "Client feedback recording";
  $("timeline-end").textContent = timecode(duration());
}

function renderTimeline() {
  const track = $("timeline-track");
  const total = duration();
  const spans = [];
  state.results.forEach((result, index) => {
    arr(result.evidence).forEach((item) => {
      const start = num(item && item.start_seconds);
      if (start === null) return;
      const end = Math.max(start, num(item.end_seconds) ?? start);
      spans.push({ index, start, end, result });
    });
  });
  spans.sort((a, b) => a.start - b.start);
  const laneEnds = [];
  for (const span of spans) {
    let lane = laneEnds.findIndex((end) => end <= span.start);
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = span.end;
    span.lane = lane;
  }
  const lanes = Math.max(1, laneEnds.length);
  track.style.setProperty("--lanes", String(lanes));
  track.replaceChildren(...spans.map((span) => {
    const left = Math.min(100, (span.start / total) * 100);
    const width = Math.min(100 - left, ((span.end - span.start) / total) * 100);
    const label = `${routeLabel(span.result)}: ${str(span.result.title) || "Untitled"}, ${timecode(span.start)} to ${timecode(span.end)}`;
    const marker = el("button", {
      type: "button",
      class: `timeline-marker ${routeKey(span.result)}`,
      "data-index": span.index,
      "aria-label": label,
      title: label,
      onclick: () => jumpTo(span.index, span.start),
    });
    // CSSOM writes are allowed under a strict style-src CSP; style attributes are not.
    marker.style.left = `${left}%`;
    marker.style.width = `${width}%`;
    marker.style.setProperty("--lane", String(span.lane));
    return marker;
  }));
  const present = Object.keys(ROUTES).filter((key) => state.results.some((r) => routeKey(r) === key));
  $("legend").replaceChildren(...present.map((key) => el("li", {}, [el("span", { class: `swatch ${key}`, "aria-hidden": "true" }), ROUTES[key].label])));
}

function renderAnalysis() {
  const analysis = state.data.analysis || {};
  const timings = analysis.timings || {};
  const usage = analysis.usage || {};
  const rows = [["Model", str(analysis.model) || "Unknown"]];
  const seconds = num(timings.analysis_seconds);
  if (seconds !== null) rows.push(["Gemini analysis", `${seconds.toFixed(1)} s`]);
  const tokens = num(usage.total_tokens);
  if (tokens !== null) rows.push(["Total tokens", tokens.toLocaleString("en-US")]);
  for (const key of Object.keys(ROUTES)) {
    const count = state.results.filter((r) => routeKey(r) === key).length;
    if (count || key === "candidate") rows.push([ROUTES[key].label, String(count)]);
  }
  $("stats").replaceChildren(...rows.map(([term, value]) => el("div", {}, [el("dt", { text: term }), el("dd", { text: value })])));
  $("analysis-summary").textContent = str(analysis.summary);
  $("project-context").textContent = str(state.data.project_context) || "No project context was provided.";
}

/* ---------- Queue ---------- */

function renderQueue() {
  const groups = Object.keys(ROUTES)
    .map((key) => ({ key, items: state.results.map((r, i) => [r, i]).filter(([r]) => routeKey(r) === key) }))
    .filter((group) => group.items.length);
  if (!groups.length) {
    $("queue").replaceChildren(el("p", { class: "muted", text: "This run produced no routed results." }));
    return;
  }
  $("queue").replaceChildren(...groups.map((group) => el("div", { class: "route-group" }, [
    el("h3", {}, [routeLabel(group.items[0][0]), el("span", { text: String(group.items.length) })]),
    ...group.items.map(([result, index]) => {
      const start = firstSecond(result);
      return el("button", {
        type: "button",
        class: `queue-card ${routeKey(result)}${index === state.selected ? " is-selected" : ""}`,
        "aria-pressed": index === state.selected ? "true" : "false",
        "data-index": index,
        onclick: () => select(index),
      }, [
        el("span", { class: "queue-card-title" }, [el("span", { text: str(result.title) || "Untitled result" }), el("span", { text: str(result.confidence) ? `${result.confidence} confidence` : "" })]),
        el("span", { class: "queue-card-meta" }, [start !== null ? timecode(start) : "No timestamp", state.approved.has(index) ? " · Approved" : ""]),
      ]);
    }),
  ])));
}

/* ---------- Detail ---------- */

function section(title, content) {
  return content ? el("section", { class: "detail-section" }, [el("h4", { text: title }), content]) : null;
}

function paragraph(value) {
  const text = str(value);
  return text ? el("p", { text }) : null;
}

function renderEvidence(result, index) {
  const items = arr(result.evidence).filter((item) => item && typeof item === "object");
  if (!items.length) return null;
  return el("div", { class: "evidence-list" }, items.map((item) => {
    const start = num(item.start_seconds);
    const end = num(item.end_seconds);
    const quote = str(item.client_quote);
    const visual = str(item.visual_observation);
    const time = start === null ? "No timestamp" : `${timecode(start)}${end !== null && end > start ? ` - ${timecode(end)}` : ""}`;
    return el("div", { class: "evidence-item" }, [
      start === null
        ? el("span", { class: "evidence-time", text: time })
        : el("button", { type: "button", class: "evidence-time", "aria-label": `Play evidence from ${time}`, onclick: () => jumpTo(index, start) }, [`▶ ${time}`]),
      quote ? el("blockquote", { class: "evidence-quote", text: `“${quote}”` }) : null,
      visual ? el("p", { class: "evidence-copy" }, [el("strong", { text: "Seen on screen: " }), visual]) : null,
      !quote && !visual ? el("p", { class: "evidence-copy", text: "No quote or visual observation recorded." }) : null,
    ]);
  }));
}

function renderApproval(result, index) {
  const key = routeKey(result);
  const box = el("section", { class: "approval" }, [el("h4", { text: "Approval" })]);
  if (ROUTE_NO_APPROVAL[key] || result.approval_eligible === false || !result.issue_preview) {
    box.append(el("p", { class: "immutable-note", text: ROUTE_NO_APPROVAL[key] || "This result is not eligible for approval, so Framewise offers no approve action." }));
    return box;
  }
  if (state.approved.has(index)) {
    box.append(renderIssuePreview(result.issue_preview));
    return box;
  }
  const needsConfirm = key === "manual_review";
  const button = el("button", {
    type: "button",
    class: "button button-primary",
    disabled: needsConfirm && !state.confirmed.has(index),
    onclick: () => { state.approved.add(index); render(); focusDetail(); },
  }, ["Approve"]);
  if (needsConfirm) {
    const id = `confirm-${index}`;
    const checkbox = el("input", {
      type: "checkbox",
      id,
      checked: state.confirmed.has(index),
      onchange: (event) => {
        if (event.target.checked) state.confirmed.add(index);
        else state.confirmed.delete(index);
        button.disabled = !event.target.checked;
      },
    });
    box.append(
      el("p", { class: "muted", text: "This finding is visually inferred, so a reviewer must confirm it against the recording before approving." }),
      el("label", { class: "confirmation-row", for: id }, [checkbox, "I confirmed this visually inferred finding"]),
    );
  } else {
    box.append(el("p", { class: "muted", text: "Approving shows the exact issue Framewise would create for this candidate." }));
  }
  box.append(el("div", { class: "detail-actions" }, [button]));
  return box;
}

function renderIssuePreview(preview) {
  const urls = arr(state.data.proof_issue_urls).filter((url) => /^https:\/\/github\.com\//.test(String(url)));
  return el("div", { class: "issue-preview" }, [
    el("p", { class: "preview-lede", text: "This is the exact issue Framewise would create." }),
    el("div", { class: "issue-card" }, [
      el("p", { class: "issue-title", text: str(preview.title) || "Untitled issue" }),
      el("pre", { class: "issue-body", text: typeof preview.body === "string" ? preview.body : "" }),
    ]),
    el("div", { class: "publish-note" }, [
      el("p", { text: "Publishing is disabled in the hosted demo. These issues were created by Framewise in a real run:" }),
      urls.length
        ? el("ul", {}, urls.map((url) => el("li", {}, [el("a", { class: "issue-link", href: url, rel: "noopener", text: url.replace("https://github.com/", "") })])))
        : el("p", { class: "muted", text: "No proof issues are listed for this replay." }),
    ]),
  ]);
}

function renderDetail() {
  const detail = $("detail");
  const result = state.results[state.selected];
  if (!result) {
    detail.replaceChildren(el("p", { class: "empty-detail", text: "Select a routed result to inspect it." }));
    return;
  }
  const index = state.selected;
  const key = routeKey(result);
  const chips = [str(result.type), str(result.intent), str(result.confidence) && `${result.confidence} confidence`, str(result.component), result.visually_inferred ? "visually inferred" : ""]
    .filter(Boolean)
    .map((text) => el("span", { class: "meta-chip", text: text.replace(/_/g, " ") }));
  const criteria = arr(result.acceptance_criteria).map(str).filter(Boolean);
  const frame = num(result.evidence_frame_seconds);
  const parts = [
    el("span", { class: `route-label ${key}`, text: routeLabel(result) }),
    el("h3", { class: "routed-result-title", tabindex: "-1", id: "detail-title", text: str(result.title) || "Untitled result" }),
    el("p", { class: "route-description", text: str(result.route_description) }),
    chips.length ? el("div", { class: "detail-meta" }, chips) : null,
    section("Summary", paragraph(result.summary)),
    section("Requested outcome", paragraph(result.requested_outcome)),
    section("Acceptance criteria", criteria.length ? el("ul", {}, criteria.map((text) => el("li", { text }))) : null),
    section("Clarification question", paragraph(result.clarification_question)),
    section("Evidence", renderEvidence(result, index)),
    frame !== null ? el("p", { class: "muted" }, ["Evidence frame at ", el("button", { type: "button", class: "link-button", onclick: () => seek(frame) }, [timecode(frame)])]) : null,
    section("Why it was routed here", paragraph([str(result.rationale), str(result.reason_code) && `Reason code: ${result.reason_code}`].filter(Boolean).join("\n"))),
    renderApproval(result, index),
  ];
  detail.replaceChildren(...parts.filter(Boolean));
}

function focusDetail() {
  const title = $("detail-title");
  if (title) title.focus({ preventScroll: true });
}

function select(index) {
  if (index === state.selected) return;
  state.selected = index;
  render();
}

function render() {
  const active = document.activeElement;
  const refocus = active && active.classList.contains("queue-card") ? active.dataset.index : null;
  renderQueue();
  if (refocus !== null) {
    const card = document.querySelector(`.queue-card[data-index="${refocus}"]`);
    if (card) card.focus();
  }
  renderDetail();
  for (const marker of document.querySelectorAll(".timeline-marker")) {
    marker.classList.toggle("is-selected", Number(marker.dataset.index) === state.selected);
  }
}

/* ---------- Boot ---------- */

async function boot() {
  try {
    const response = await fetch("demo.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`demo.json returned ${response.status}`);
    state.data = await response.json();
  } catch (error) {
    const box = $("load-error");
    box.textContent = `Could not load the demo data (${error.message}).`;
    box.hidden = false;
    return;
  }
  if (!state.data || typeof state.data !== "object") state.data = {};
  state.results = arr(state.data.results)
    .filter((r) => r && typeof r === "object")
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ROUTES[routeKey(a.r)].order - ROUTES[routeKey(b.r)].order || (firstSecond(a.r) ?? 1e9) - (firstSecond(b.r) ?? 1e9) || a.i - b.i)
    .map(({ r }) => r);
  renderVideoMeta();
  setupPlayer();
  renderTimeline();
  renderAnalysis();
  state.selected = state.results.length ? 0 : -1;
  render();
}

boot();
