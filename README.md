# Mecha AI

A local, single-user desktop web app that automates production of AI-generated
marketing UGC for fictional brand personas. You pick a persona and a style,
pull reference imagery, let an LLM write generation prompts, and fire batches of
image/video jobs through a durable queue — reviewing, redoing, and delivering the
results to Slack.

> **Design principle:** use the LLM for *words* and a direct tool client for
> *pixels*. Grok handles reasoning (search seeds, recreation/subject-swap prompts,
> rewrite-on-rejection, character creation). A separate worker fires the actual
> generations against Higgsfield / fal and polls them to completion.

---

## Architecture

```
Browser (Next.js UI) ──poll / SSE──┐
                                    ▼
                             SQLite (data/mecha.db)   ◄── single source of truth
                                    ▲
Worker process (p-queue) ───────────┘
   ├─ Higgsfield MCP   submit → job_display poll → download   (Soul 2.0, etc.)
   ├─ fal.ai           queue submit → poll → download          (optional)
   └─ Grok (xAI)       search seeds · subject-swap (vision) · rewrite · character creator
External: Pinterest (no-key scrape) · Instagram (RapidAPI) · Slack
```

The UI and the worker communicate only through the shared SQLite DB. The worker is
the sole writer of generation results, so a crash + restart resumes polling
existing jobs rather than resubmitting.

---

## Tech stack

- **Next.js (App Router) + TypeScript** — UI + API routes
- **Tailwind CSS + shadcn/ui** (on `@base-ui/react`) — glassmorphism UI
- **SQLite + Drizzle ORM** (`better-sqlite3`) — persistent job/asset/character state
- **Standalone Node worker** (`tsx`) + **`p-queue`** — concurrency-limited job runner
- **Model Context Protocol SDK** — Higgsfield MCP client (OAuth PKCE)

---

## Prerequisites

- **Node.js 20+**
- **ffmpeg** on your PATH (used to extract the first frame from reel references)
- A **Higgsfield** account (for Soul-based generation)
- An **xAI** API key (for prompt reasoning / vision)

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
#   then edit .env.local — at minimum set XAI_API_KEY.
#   Higgsfield is connected from the app UI (see below), not the env file.

# 3. Create the database
npm run db:push

# 4. Run the app (two processes)
npm run dev        # Next.js UI  (http://localhost:3000, or 3001 if 3000 is taken)
npm run worker     # job worker  (run in a second terminal)
```

Open the app, then:

1. **Settings → Connect Higgsfield MCP** — completes the OAuth flow in your
   browser and captures/refreshes the token automatically. (Or paste a token
   manually under "Advanced".)
2. **Settings → Discover Tools / Sync Characters** — pulls your Soul characters
   into the local DB.

---

## Required configuration

| Key | Required | Purpose |
|-----|----------|---------|
| `XAI_API_KEY` | **Yes** | Grok prompt reasoning + vision |
| `HIGGSFIELD_MCP_URL` | Yes (default set) | Higgsfield MCP endpoint |
| `HIGGSFIELD_OAUTH_TOKEN` / `HIGGSFIELD_CLIENT_ID` | Auto | Managed by the in-app connect flow |
| `APIFY_TOKEN` | For reels | Instagram browsing/reel download (`apify/instagram-scraper` actor) |
| `RAPIDAPI_KEY` | Optional | Only needed alongside `RAPIDAPI_PINTEREST_HOST` below |
| `RAPIDAPI_PINTEREST_HOST` | Optional | Override the built-in no-key Pinterest scraper |
| `FAL_KEY` | Optional | Alternate image provider (nano-banana / seedream) |
| `RUNNINGHUB_*` | Phase 3 | Talking-head + motion-capture video |
| `SLACK_WEBHOOK_URL` / `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` | For delivery | Post approved assets + interactive approval |
| `IMAGE_CONCURRENCY` / `VIDEO_CONCURRENCY` | Yes (default set) | Worker concurrency per provider |
| `DAILY_COST_CAP` | Yes (default set) | Halts new submissions past this credit total |
| `DATABASE_PATH` | Yes (default set) | SQLite file location |

> **Pinterest needs no key** — it uses a built-in native search.
> Only set `RAPIDAPI_PINTEREST_HOST` if you want to route through a paid RapidAPI
> Pinterest endpoint instead.

---

## Image workflow

`Setup → Search Query → References → Recreation → Generate → Review`

1. **Setup** — pick a character, a preset, and a generation provider/model
   (Soul 2.0 by default), plus quality / aspect ratio / batch size.
2. **Search Query** — uses the preset's seed directly as the Pinterest query.
3. **References** — search Pinterest, multi-select usable reference images.
4. **Recreation** — Grok vision performs a *Visual Subject Swap*: it looks at the
   scene reference + the character's face and writes a generation prompt.
5. **Generate** — enqueues jobs; the worker submits to Higgsfield and polls.
6. **Review** — Approve (→ Slack) or Reject with notes (→ Grok rewrites the prompt
   and queues a fresh job — never a verbatim re-run). Download all results as a zip.

Characters can also be built with the **AI Character Creator** — upload 2–4 face
references and Grok blends them into one unique composite persona.

---

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the Next.js UI |
| `npm run worker` | Start the background job worker (required for generation) |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run db:push` | Apply the Drizzle schema to SQLite |
| `npm run db:generate` | Generate a new migration from schema changes |
| `npm run db:studio` | Open Drizzle Studio |

---

## Notes

- **Single-user / local by design.** There is no auth on the local server and
  storage is file-based (`data/`, `storage/`). Don't expose it to an untrusted
  network without adding authentication and moving to Postgres + object storage.
- **Secrets** live only in `.env.local` and `data/` (OAuth token files) — both
  gitignored. Never commit them.
- All generated content depicts **fictional AI personas**; reference media is
  supplied by the operator from URLs.
