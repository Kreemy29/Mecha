# Build Spec — AI UGC Content Automation Tool

> **For Claude Code.** This is a complete build specification for a local, single-user desktop web app. Build it in phases (Section 11). Do not skip the discovery steps in Section 4 — several external tool schemas must be confirmed live rather than assumed. Ask me before inventing any API shape you can't verify.

---

## 1. Project Overview

A local web app (runs at `localhost`, used by one person on one machine) that automates production of AI-generated marketing UGC for fictional brand personas. Output targets per cycle:

- ~20 still images
- 5 talking-head videos
- 10 motion-capture videos

All generated content is reviewed by the operator and delivered to a Slack channel for approval. No real individuals are depicted; "characters" are fictional, reusable AI personas. Reference media comes from URLs the operator supplies (collaborators send their own Instagram reels / Pinterest pins with consent) — the app downloads from given URLs, it is **not** a mass scraper of strangers.

The app must comfortably run **10–20 image jobs and 5 video jobs concurrently** with retries and cost caps.

---

## 2. Core Architecture Principle

**Use the LLM for words, and a direct tool client for pixels.**

- An LLM (Grok via the xAI API) handles *reasoning*: generating search-style prompts, writing recreation prompts from a reference + character profile, and rewriting prompts when the operator rejects a result with notes.
- A **non-LLM worker** fires the actual generations by calling the generation services directly (Higgsfield MCP for images/video, RunningHub REST for the two video types). These services are **async**: submit job → poll status → retrieve result URL. Model this as a durable job queue, never as a blocking request.

Do not route every generation through an LLM agent loop — it's slow, costly, and non-deterministic at batch scale. The LLM is only invoked for the text-generation steps above.

---

## 3. Tech Stack

- **Next.js (App Router)** + **TypeScript** — UI at localhost.
- **shadcn/ui** + **Tailwind CSS** — all components. Initialize shadcn and add components as needed (`button`, `card`, `dialog`, `tabs`, `table`, `badge`, `progress`, `textarea`, `input`, `select`, `sonner` for toasts, `scroll-area`, `skeleton`).
- **SQLite + Drizzle ORM** — persistent job/asset/character/preset state. Must survive restarts.
- **Background worker** — a separate Node process (not an API route) using **`p-queue`** for concurrency limiting + a hand-rolled retry/backoff wrapper. The worker polls external jobs and writes status to SQLite.
- **Local filesystem** for downloaded references and generated assets (`./storage/references`, `./storage/output`). Store relative paths in DB.
- **Slack** delivery via incoming webhook (and optionally a bot token if richer messages are wanted).
- Keep it self-contained: **no Redis, no Postgres, no cloud auth.**

UI ↔ worker communication: shared SQLite DB. The UI polls (or uses a simple SSE endpoint) for job status; the worker is the only writer of generation results.

---

## 4. External Services — Integration Notes (CONFIRM SCHEMAS LIVE)

### 4.1 Higgsfield MCP (image + video generation)
- Official hosted MCP server at `https://mcp.higgsfield.ai`, **OAuth** (no static API key). Runs against the operator's existing Higgsfield credits.
- Exposes 30+ models incl. **Soul / Soul 2.0** (image) and video models, plus **character training/management** and a **Soul Character** primitive for multi-shot identity consistency, and **talking-head video** generation. Tools are **async-shaped** (submit / poll / retrieve).
- **DISCOVERY STEP:** Before coding against it, connect an MCP client to the server and list its actual tools + input schemas. Do not hardcode tool names or argument shapes from memory — enumerate them and generate a typed client from what's actually exposed. If OAuth interactive flow is awkward inside the worker, confirm with me how I want to handle the token (e.g., obtain once interactively, cache the token, refresh as needed).
- Reference fallbacks if useful: community FastMCP servers exist (e.g. `geopopos/geo_higgsfield_ai_mcp`) — use only to understand tool shapes, prefer the official hosted server.
- **Character consistency:** persist each persona's character/`soul` reference id so every generation for that persona reuses it.
- **NSFW ceiling:** Higgsfield filters explicit content (rejected requests are not charged). The app supports suggestive-but-clothed marketing aesthetics; design the error path to surface "rejected by content filter" cleanly rather than treating it as a transient failure to retry.

### 4.2 xAI Grok (prompt reasoning)
- OpenAI-compatible chat completions at `https://api.x.ai/v1`. API key via env.
- Three distinct prompt-generation tasks (give each its own well-tuned system prompt, see Section 6/7):
  1. **Search-prompt expansion** — given a preset, produce N varied search queries.
  2. **Recreation prompt** — given a reference image/frame description + a character profile, write a generation prompt that recreates the vibe with the persona's hardcoded features.
  3. **Rewrite-on-rejection** — given the previous prompt + the operator's rejection notes, produce an improved prompt.

### 4.3 RunningHub (talking-head + motion-capture video)
- Cloud ComfyUI platform with a REST API. **Paid membership required — free accounts cannot call the API.** Follow the official docs at `runninghub.ai` (RunningHub API doc).
- Pattern: POST to run a workflow by **`workflow_id`** with **`node_info_list`** inputs (base image + reference video + seed, etc.) → receive a task id → poll for status → retrieve output **file URLs**.
- There are two workflows: one for **talking head**, one for **motion capture**. Their `workflow_id`s and the exact `node_info_list` field names are **operator-supplied via env/config** (see Section 13) — leave them as configurable placeholders and build the generic submit/poll/download client around them.

### 4.4 Reference fetching (RapidAPI)
- Operator pastes an Instagram reel URL or Pinterest pin/board URL (sent to them by consenting collaborators).
- Use a RapidAPI endpoint to resolve the media, then download locally. For reels: download video, then **extract the first frame** (use `ffmpeg`) to use as the recreation reference image.
- Endpoints break often — wrap in retry + clear error surfacing, and keep the RapidAPI host/path in config so it can be swapped without code changes.

---

## 5. Data Model (Drizzle / SQLite)

```
characters        id, name, feature_profile (text — hardcoded physical/style description
                  injected into recreation prompts), higgsfield_character_ref, created_at
presets           id, name, description, type (image|video), search_prompt_seed, active
batches           id, type (image|talking_head|motion_capture), character_id, status, created_at
references        id, batch_id, source_url, source_kind (pinterest|instagram|manual),
                  local_path, frame_path (nullable, for reels), selected (bool)
jobs              id, batch_id, character_id, reference_id (nullable), kind
                  (image|talking_head|motion_capture), status
                  (queued|running|polling|succeeded|failed|filtered|rejected),
                  provider (higgsfield|runninghub), provider_job_id, prompt,
                  prompt_history (json — every prompt + rejection note across redo loops),
                  attempts, output_path, error, cost_estimate, created_at, updated_at
settings          key, value  (for runtime config / cost caps)
```

`prompt_history` is important: it stores the full chain of prompt → result → rejection note → new prompt so the redo loop has context and so the operator can audit what changed.

---

## 6. Workflows

### 6.1 Image workflow (page: `/images`)
1. **Pick character + preset.** Operator selects a persona and a preset card. Presets are user-configurable categories (e.g. "outdoor portrait", "OOTD selfie", "mirror selfie") — seed with a few editable examples, do not hardcode a fixed list.
2. **Generate search prompts.** Button → Grok expands the preset into N (default 5) varied search queries. Show them, allow edit/remove.
3. **Fetch references.** Run each query through the RapidAPI Pinterest endpoint, pull results across the first 5 pages, download thumbnails. Display as a selectable grid of **cards** (shadcn `card` + checkbox overlay).
4. **Select references.** Operator multi-selects which to use; selected items download in full and mark `selected = true`.
5. **Write recreation prompts.** For each selected reference, send (reference description + character `feature_profile`) to Grok → recreation prompt. Show editable prompts.
6. **Generate.** Enqueue one job per prompt → worker calls Higgsfield Soul via MCP, reusing the character ref. Live status in a results grid (queued → running → polling → done) with `progress`/`skeleton` placeholders.
7. **Review + redo loop.** Each result card has Approve / Reject. Reject opens a `textarea` for notes → triggers the rewrite loop (Section 7). Approved images go to Slack.

### 6.2 Video workflow (pages: `/talking-head`, `/motion-capture`)
1. **Input reference.** Operator pastes an Instagram reel (or Pinterest video) URL → RapidAPI download → `ffmpeg` extract first frame.
2. **Pick character.** Select persona (provides base image + character ref).
3. **Recreation prompt** from the extracted frame + character profile via Grok (editable).
4. **Slack approval gate.** Post the planned recreation (frame + prompt + persona) to Slack and wait for approval **before** spending RunningHub credits. Approval can be a manual "Approved" toggle in the app (simplest) or a Slack interaction — confirm with me which.
5. **Generate.** On approval, enqueue a RunningHub job with the correct `workflow_id` (talking-head vs motion-capture), passing base image + reference video via `node_info_list`. Poll → download output.
6. **Review + redo loop** as in 6.1 step 7 → Slack on approval.

---

## 7. The Regeneration-with-Notes Loop (build as a first-class feature)

When the operator rejects a result with notes:
1. Append `{prompt, output_path, rejection_note}` to the job's `prompt_history`.
2. Send the **previous prompt + the rejection note + the character profile** to Grok with the "rewrite-on-rejection" system prompt → improved prompt.
3. Enqueue a **new** job (do not resubmit the identical prompt). Increment `attempts`.
4. Surface a per-job attempt count and let the operator give up after N tries (configurable cap).

The key behavior the operator wants: rejection never just re-runs the same prompt — it always passes the critique back through Grok first.

---

## 8. Concurrency, Queue & Reliability

- Worker uses `p-queue` with **separate concurrency limits per provider** (e.g. images: 20, videos: 5) — configurable in `settings`.
- Each job: submit → store `provider_job_id` → poll on an interval with backoff → on completion download asset locally and set `succeeded`.
- **Retries:** transient/network errors retry with exponential backoff (cap attempts). **Content-filter rejections do NOT retry** — mark `filtered` and surface to the operator.
- **Cost caps:** track `cost_estimate` per job and a running batch/daily total; a configurable ceiling halts new submissions and warns, so a runaway batch can't drain Higgsfield/RunningHub credits.
- Jobs are idempotent: a crash + restart resumes polling existing `provider_job_id`s rather than resubmitting.

---

## 9. UI / Pages (shadcn)

- **Layout:** left nav (Dashboard, Images, Talking Head, Motion Capture, Characters, Presets, Settings), main content area. `sonner` for toasts.
- **Dashboard** — live job table (`table` + status `badge`s), per-provider concurrency usage, today's cost vs cap (`progress`), recent deliveries.
- **Images / Talking Head / Motion Capture** — the stepped workflows above, ideally a `tabs` or stepper layout so the operator moves prompt → fetch → select → generate → review.
- **Characters** — CRUD for personas: name, `feature_profile` textarea, linked Higgsfield character ref, base image upload.
- **Presets** — CRUD for preset cards.
- **Settings** — API keys status, concurrency limits, cost caps, RunningHub workflow ids, Slack channel.

Aim for a clean, dense, operator-focused tool aesthetic (this is an internal power tool, not a marketing site). Keyboard-friendly review (approve/reject) is a plus.

---

## 10. Environment Variables (`.env.local`)

```
XAI_API_KEY=
HIGGSFIELD_MCP_URL=https://mcp.higgsfield.ai
# Higgsfield OAuth token handling — confirm approach (cached token vs interactive)
RUNNINGHUB_API_KEY=
RUNNINGHUB_TALKING_HEAD_WORKFLOW_ID=
RUNNINGHUB_MOTION_CAPTURE_WORKFLOW_ID=
RAPIDAPI_KEY=
RAPIDAPI_PINTEREST_HOST=
RAPIDAPI_INSTAGRAM_HOST=
SLACK_WEBHOOK_URL=
IMAGE_CONCURRENCY=20
VIDEO_CONCURRENCY=5
DAILY_COST_CAP=
```

---

## 11. Build Phases (do these in order; each must run before moving on)

1. **Skeleton** — Next.js + TS + Tailwind + shadcn init; SQLite + Drizzle schema + migrations; the standalone worker process with `p-queue`; a generic async-job runner (submit/poll/download abstraction); Dashboard shell showing the (empty) job table. Verify the worker picks up a dummy job and writes status.
2. **Image workflow** — full pipeline of Section 6.1 against Higgsfield MCP, including the Section 7 redo loop and Slack delivery.
3. **Video workflows** — Section 6.2 for talking-head and motion-capture against RunningHub, with the Slack approval gate.
4. **Scale + polish** — per-provider concurrency, retry/backoff, cost caps, idempotent resume-on-restart, review-screen keyboard shortcuts.

---

## 12. Acceptance Criteria

- Can run 20 image jobs + 5 video jobs concurrently without blocking the UI; status updates live.
- Rejecting a result with notes produces a *new, Grok-rewritten* prompt and a new job — never a verbatim re-run.
- Character identity is consistent across a persona's generations (Higgsfield character ref reused).
- A crash mid-batch resumes polling on restart; no duplicate submissions.
- Cost cap halts new submissions when exceeded.
- Content-filter rejections are shown as such, not retried.
- Approved assets land in the Slack channel.

## 13. Known Stubs / Operator-Supplied Config

- RunningHub `workflow_id`s and their `node_info_list` field names — supplied via env; build the client generically around them.
- Exact Higgsfield MCP tool names/schemas — **enumerate live** (Section 4.1), don't assume.
- RapidAPI host/path for Pinterest + Instagram — supplied via env; keep swappable.
- Each persona's `feature_profile` text and Higgsfield character ref — entered by operator in the Characters page.

---

**First action:** scaffold Phase 1 and confirm the dummy-job round-trip through the worker before integrating any external service.
