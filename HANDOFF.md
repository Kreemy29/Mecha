# OneUp Studio (repo: Mecha AI): developer handoff

What the product does, for users, is in [README.md](README.md). This file is
for whoever works on the code next: how it's built, why, what's fragile, and
what's unfinished. Deployment steps are in [DEPLOY.md](DEPLOY.md).

Last updated 2026-10-02.

---

## 1. Read this first: current state

- **Live app: `https://mecha-3-u433.onrender.com`.** The team's accounts and
  data are there. It auto-deploys from **`Kreemy29/Mecha` → `main`**.
- **That Render service is not in rayen's Render account** (another login owns
  it and nobody knows which). So its environment variables and disk can't be
  changed from here. Consequences so far:
  - `SETUP_TOKEN` there is an unknown 32-char value, so first-run setup was
    unlocked with a pinned hash (see §8, "Setup code").
  - The Telegram bot token and Gmail login are therefore **pasted into the app**
    (Settings → Accounts → Notifications), stored in the DB, not env.
  - We don't know if it has a persistent disk (accounts have survived
    deploys, which suggests it does).
- **A second service, `https://oneupai-kww0.onrender.com`, is rayen's own**,
  but it's empty (no accounts) and has **no disk** (`[start] no disk at /data`
  in its logs: everything is wiped on each deploy). It holds a
  `TELEGRAM_BOT_TOKEN` env var. Both services build from the same repo.
- Decision pending: get access to `mecha-3`, or move to `oneupai-kww0` (add a
  disk, set env, recreate ~5 accounts). Until then, never click "Connect bot
  webhook" on `oneupai-kww0`: it would steal the bot from the live app (codes
  then "expire", §6.4).
- **Settings → Accounts → Server check** (admin) shows which service and
  commit is answering and which env vars it can see (lengths only). Use it
  before debugging anything config-related.

---

## 2. Architecture

```
Browser (Next.js UI) ──fetch──┐
                              ▼
                     SQLite (data/mecha.db)   ◄── single source of truth
                              ▲
Worker process (p-queue) ─────┘
   ├─ Higgsfield MCP   images (Soul), Seedance video, Kling motion_control
   ├─ KIE AI           Seedance video (alternate provider)
   ├─ RunningHub       Wan Animate character replacement
   ├─ fal.ai           nano-banana images (background swap etc.)
   └─ Grok / Gemini    vision + prompt writing (services/llm.ts picks)

Desktop tracker / Chrome extension ──► /api/tracker/ext (key auth)
Telegram ──► /api/telegram/webhook (secret header)
```

- **UI and worker talk only through SQLite.** The UI writes jobs as `queued`;
  the worker is the only thing that submits them. No worker = jobs sit queued.
- **One Render service** runs both (`scripts/start-all.mjs`, Dockerfile). A
  disk at `/data` holds the DB, the Higgsfield token files and all media;
  `start-all.mjs` symlinks `./data` and `./storage` onto it. **Instances must
  stay at 1** (two workers race for jobs).
- **Tables are created at runtime** (`CREATE TABLE IF NOT EXISTS` + `ALTER
  TABLE ADD COLUMN` checks in each service's `ensure*Tables()`), never with
  `db:push`. Core tables are created in `lib/db/index.ts`.
- **Auth** (`services/auth.ts`): username + password (scrypt), session cookie
  `oneup_session`, 60-day sliding sessions. `proxy.ts` (Next 16's middleware)
  only checks a cookie exists; `requireUser()` in every route is the real
  boundary. Public paths: login/setup endpoints, `/api/tracker/ext`,
  `/api/telegram/webhook`.

---

## 3. Run it locally

```bash
npm install
npm run dev        # scripts/dev-all.mjs: next dev + the worker, worker auto-restarts
```

- `npm run dev:ui` = UI only, `npm run worker` = worker only. **Only one worker.**
- Node 22. On this PC Node and Git live at `C:\Program Files\nodejs` and
  `C:\Program Files\Git\cmd`, which are **not** on the agent shell's PATH:
  prepend them. `.claude/launch.json` starts the dev server via node's full path.
- This machine sits behind a TLS-intercepting proxy: Node needs
  `NODE_TLS_REJECT_UNAUTHORIZED=0` (it's in `.env.local`), sometimes
  `npm --strict-ssl=false`. **Never set that on Render.**

---

## 4. Code map

```
src/app/
  trends/ production/ clock/ team/ timesheets/ hours/     department pages
  instagram/ requests/ formats/                          Instagram sourcing
  images/ seedance/ motion-capture/ methods/             generation tools
  characters/ presets/ settings/ profile/ tracker/ admin/ login/
  api/
    trends/ production/ workflow/                         department pipeline
    clock/ timesheet/ team/                               time + activity views
    tracker/{ext,key,consent,extension}/                  trackers (ext = key-auth endpoint)
    telegram/ telegram/webhook/ notify-settings/ profile/ notifications + contact details
    reel/[shortcode]/                                     Instagram preview resolver
    users/ auth/ diagnostics/                             accounts, sessions, server check
    jobs/ seedance/ animate/ references/ grok/ higgsfield/ yapper/ instagram/ …
src/lib/
  roles.ts            roles, `can.*` permissions, NAV_FOR_ROLE
  nav.ts              top-bar sections + per-section tabs, who sees what
  day.ts              local-day maths (bounds, ranges, worked/break seconds)
  tracking-consent.ts the consent wording + CONSENT_VERSION
  services/
    trends.ts production.ts workflow.ts notify.ts       department
    worktime.ts clock-gate.ts                            clock, breaks, activity, consent, keys
    auth.ts                                              users, sessions
    higgsfield*.ts yapper*.ts grok.ts llm.ts kie.ts runninghub.ts instagram.ts …
  worker/             worker.ts + one provider file per backend
src/components/
  app/                top bar, section tabs, user menu, clock button (Insights chrome)
  department/         shared bits, reel preview, workflow bar, range picker
  dashboard/          Kpi / ChartCard (copied from Insights)
desktop-tracker/      Windows tray tracker (PowerShell) + launcher + README
extension/            Chrome extension (MV3)
```

---

## 5. Department pipeline: internals

### 5.1 Roles and access (`lib/roles.ts`)
`owner` (the AI Content Manager), `ceo`, `trend_researcher`, `content_creator`,
plus legacy `ai_artist`, `meta_ads`, `marketing_manager`. `isAdmin` is separate
from role. `can.suggestTrends / reviewTrends / manageProduction /
viewAllProduction / doProduction / viewTeam`. API routes check these;
`NAV_FOR_ROLE` only trims the menu.

### 5.2 Trends (`services/trends.ts`, `/api/trends`)
`trend_suggestions`: date, kind (reel|carousel), url, niche, models (JSON),
justification, status (pending|approved|rejected), review note/by/at,
created_by. Editing a rejected one resets it to pending. A trend with
production tasks can't be un-approved or deleted. `review_note` is only the
rejection reason; an approval's optional note goes into `trend_comments`
(trend, user, body) as the first comment. Comments ride along on every
`Trend` (`listTrends`/`getTrend`, so production tasks get them too);
`/api/trends/comments` adds/deletes them for anyone who can see the trend
(reviewers, managers, its researcher, creators with a task on it).

### 5.3 Production (`services/production.ts`, `/api/production`)
`production_tasks` (trend, method service+id, assignee, example model/url,
notes, due date, **sent_at, finished_at, uploaded_at, upload_url**) and
`task_items` (one per model *except* the example; drive_url, status
todo|submitted|approved|rejected, review note). Methods are saved generations
from `saved_generations` (Higgsfield, includes reference `medias`) and
`saved_yapper_generations`. The Assign dialog only offers **saved** methods (a
"browse full history" picker was tried and reverted at the user's request).

### 5.4 Hand-offs (`services/workflow.ts`, `/api/workflow`)
| action | who | notifies |
|---|---|---|
| `research_done` {date} | researcher, clocked in | managers + CEOs |
| `review_done` {date} | CEO (any reviewer who isn't a manager) | managers |
| `send_tasks` | manager | each creator with unsent tasks (marks `sent_at`) |
| `task_finished` {taskId} | the assignee, all items handed in | managers, with Drive links |
| `task_uploaded` {taskId, url} | manager | marketing managers |
Day marks live in `trend_day_marks` (date, user, kind). Links in messages use
`APP_URL` or the request's public origin (`lib/request-origin.ts`).

### 5.5 Notifications (`services/notify.ts`)
- `notifyUsers(event, users, message)` sends Telegram (if the user has a
  `telegram_chat_id`) and email (if `email`), **never throws**, logs each
  attempt to `notifications_log`, returns counts + `unreachable` names.
- **Credentials**: `notify.telegram_bot_token`, `notify.gmail_user`,
  `notify.gmail_app_password` in the `settings` table **win over** env vars
  (`TELEGRAM_BOT_TOKEN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`). Set via
  `/api/notify-settings` (admin), shown back masked only. Saving a token
  verifies it (`getMe`) and calls `setWebhook` immediately.
- **Telegram linking**: `telegramConnectLink(userId)` stores a one-time
  `telegram_link_code` and returns `t.me/<bot>?start=<code>`. The webhook
  handles `/start <code>` (links chat, replies "Connected ✅"), `/stop`, and
  anything else (help text). One chat = one account. The webhook secret is
  `TELEGRAM_WEBHOOK_SECRET` or a hash of the token.
- Telegram only lets a bot message people who pressed Start. A "team group"
  mode (bot posts in one group, tagging people) was proposed but not built.

### 5.6 Time, breaks, activity (`services/worktime.ts`)
- `work_sessions` (clock_in/out, last_seen, auto_closed) and `work_breaks`.
  **Worked = session span − breaks**, everywhere (server `secondsWithin` and
  client `lib/day.ts` `sessionSecondsWithin` mirror each other).
- Auto-close: no heartbeat for **2h** → closed at `last_seen`; a break open
  **4h** → session closed at the break's start. Heartbeats come from the app
  tab (every 60s) and the trackers.
- `clock-gate.ts`: researchers and creators must be clocked in and not on a
  break to submit.
- **Consent** (`tracking_consent`, versioned by `CONSENT_VERSION` in
  `lib/tracking-consent.ts`): `recordActivity` drops everything without it,
  and while clocked out or on break. Bump the version whenever what's
  collected changes; everyone is asked again.
- `activity` rows: kind browse (Chrome) | app (desktop) | idle | away, with
  `source` chrome|desktop and `app`. When a person has desktop rows in a
  range, idle/away come from the desktop source only (no double counting).
- Tracker keys (`tracker_keys`, hashed, `mk_…`): one per user, shared by both
  trackers. `/api/tracker/ext` accepts status / clock_in / clock_out /
  break_start / break_end / activity.

### 5.7 Trackers
- **`desktop-tracker/OneUpTracker.ps1`**: Windows PowerShell 5.1 tray app.
  Win32 `GetForegroundWindow` / `GetWindowText` / `GetLastInputInfo` via
  `Add-Type`. Samples every 5s, flushes every 60s, asks consent locally on
  first run, optional "Start with Windows" shortcut. `-TestSeconds N` runs a
  headless check. **Keep the file pure ASCII** (5.1 reads BOM-less files as
  ANSI; smart quotes become string delimiters).
- **`extension/`**: Chrome MV3, v1.2.0. Same key, same endpoint, honours
  consent and breaks. The user wavered on dropping it for the desktop tracker
  (with browser URLs read via UI Automation); that change was reverted, so
  both trackers exist.

### 5.8 Reel previews (`/api/reel/[shortcode]`, `components/department/reel-preview.tsx`)
Ported from Insights: resolve poster + mp4 from Instagram's free public embed
page (cached 6h in memory), click-to-play. Posts with embedding disabled
return no media; `?deep=1` (button "Load preview") fetches the single post
through Apify instead (costs credits, never automatic).

---

## 6. Generation pipelines

### 6.1 Seedance batch (`/seedance`)
`Setup → Videos → Background → Outfits → Stills → Seedance`: N videos × M
outfits = variants; Grok writes each still's recreation prompt, Higgsfield
renders it, you approve, then still + reference video → Seedance (3 in
parallel, `VIDEO_CONCURRENCY`).

### 6.2 Key mechanics
- **Recreation prompt** (`grok.ts` `generateSwapPrompt`) is structured JSON;
  `enforceRecreationConstraints` overwrites critical fields after Grok:
  `loras.character_lora` = the character's exact name, and **banned terms
  scrubbed everywhere** (tattoos, eyewear): Higgsfield reads the whole output
  as positive text, so even "no tattoos" backfires.
- **Saved backgrounds** are described once and frozen, then forced into
  `environment.location`. Mirrored to `backgrounds.seed.json` (committed) and
  auto-restored when the table is empty.
- **Seedance video prompt** is a static template with Higgsfield's linked
  elements `@[Image 1](image_1)` / `@[Video 1](video_1)`. Grok-written
  "technical" prompts produced wireframe renders.
- **NSFW**: Seedance jobs auto-retry on filter (credits refunded); a 45-min
  poll timeout stops wedged jobs.

### 6.3 Provider quirks
- **Higgsfield `generate_video`**: model id `seedance_2_0`; media roles
  `image_references` / `video_references`; may intercept with a "preset
  recommendation", auto-declined via `declined_preset_id`.
- **KIE Seedance**: `reference_image_urls` / `reference_video_urls`,
  `nsfw_checker` (false = off); the video is pre-encoded to KIE's pixel budget
  and ≤15s (`prepareVideoForKie`).
- **RunningHub Wan Animate** needs the Plus (48G) instance.
- **Kling 3.0** (`motion_control`): no prompt; `resolution`, `sceneControl`.
- Higgsfield's "Check eligibility" isn't available via the API.
- **Yapper**: REST with an API key. **The API requires a paid team plan**;
  keys are validated against `/processes` (not `/credits`) and Yapper's own
  refusal reason is shown. Yapper also runs an MCP server
  (`https://yapper.so/mcp/connector`, OAuth, with `yapper_list_processes`),
  not wired up.

### 6.4 Higgsfield connection
OAuth to `mcp.higgsfield.ai` from Settings → Connections. Tokens are files in
`data/` (`higgsfield-accounts.json`, legacy `higgsfield-token.json`), refreshed
automatically (single-use refresh tokens; web and worker re-read the file to
avoid racing). Higgsfield's login sends an email code; being signed in to
higgsfield.ai in the browser doesn't help (different site, and the server
needs its own token). **If the user has to reconnect after every deploy, the
service has no persistent disk.**

---

## 7. Design system

The UI copies **OneUp Insights** (`github.com/3morad/Oneup-Insights`, cloned
at `D:\work\automaton\Oneup-Insights`), dark variant: ink `#0A1418` / cards
`#0F1D22` / orange `#F7931E`, Inter Tight + Raleway + Geist Mono (self-hosted
via `@fontsource-variable/*` and `geist`, so builds never fetch Google Fonts),
flat cards, Phosphor icons in the chrome, Insights' `Kpi`/`ChartCard`,
section tabs, login layout and reel player. The old `glass*` classes are now
flat-card aliases in `globals.css`. **Copy patterns from Insights before
inventing new ones.**

---

## 8. Gotchas

1. **Restart the worker** after any change under `src/lib/worker/` or a service
   it imports.
2. **Only one worker** at a time.
3. **Drizzle selects every schema column**, so new `users` columns must be
   added (`ensureAuthTables` ALTERs) before any `db.select().from(users)`. Call
   `ensureAuthTables()` first in any new route that reads users directly.
4. **`next build` SQLite locking**: 47 build workers open the DB at once.
   `lib/db/index.ts` sets `busy_timeout` *before* WAL, runs the schema in an
   IMMEDIATE transaction and retries. Don't reorder that.
5. **Setup code**: `/api/auth/setup` also accepts a code by its pinned SHA-256
   (`PINNED_CODE_SHA256`), added because `mecha-3`'s `SETUP_TOKEN` is
   unreachable. It's only checked while there are zero users. Remove it once
   hosting is sorted. A wrong code shows both codes' fingerprints.
6. **React 19 compiler lint**: no `setState` synchronously in effects (wrap the
   load in an async IIFE or use `useSyncExternalStore`), no `Date.now()` /
   `Math.random()` in render (go through a helper), no mutating `.sort()`
   feeding memoised values. 16 such errors remain in older pages (Seedance,
   Images, Settings…); they don't block builds.
7. **Line endings**: Git converts to CRLF on Windows checkouts; perl/sed
   multi-line patterns can silently miss. Prefer exact edits.
8. **Render env changes apply on deploy only**, and a value shown in plain
   text in the dashboard usually means it isn't saved yet.

---

## 9. Git

- `origin` = `https://github.com/Kreemy29/Mecha.git`. **`main` is what deploys.**
  Work happens on `seedance` and is pushed to both (`git push origin seedance
  seedance:main`).
- `upstream-3morad` = `3morad/mecha-ai` (the old remote; local `main` still
  tracks it).
- Leftover untracked `tmp-e2e.ts` in the repo root (old scratch script, it
  created an "E2E Temp" user). Not committed.

---

## 10. Open / next

- **Hosting**: decide `mecha-3` (find its owner) vs `oneupai-kww0` (add disk +
  env, recreate accounts). Then remove the pinned setup hash and the
  `TELEGRAM_BOT_TOKEN` env var on whichever service isn't used.
- **Revoke the Telegram bot token** with BotFather `/revoke` (it was posted in a
  chat) and paste the new one in Settings → Accounts.
- Notify creators when a hand-in is **rejected** (not built).
- Optional: Telegram **team group** mode; in-app notification bell.
- Higgsfield reconnects: confirm whether it's per deploy (disk) or periodic
  (refresh flow).
- Yapper: needs a paid plan on the team that owns the key, or wire up its MCP.
- Desktop tracker is Windows-only and unsigned (SmartScreen "Unblock" step).
- Older items: Higgsfield `ip_detected` handling, KIE result-download check,
  the external ComfyUI Wan Animate workflow (`bg_images` should come from the
  reference image).
