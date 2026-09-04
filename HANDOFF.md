# Mecha AI — Project Handoff

A local, single-user desktop web app that automates AI-generated marketing UGC
for fictional brand personas. This branch (`seedance`) adds **video recreation**
pipelines (Seedance + Wan Animate) on top of the original image pipeline.

---

## 1. Big picture

Two processes talk only through a shared SQLite DB:

```
Browser (Next.js UI) ──poll──┐
                             ▼
                      SQLite (data/mecha.db)   ◄── single source of truth
                             ▲
Worker process (p-queue) ────┘
   ├─ Higgsfield MCP   images (Soul) + Seedance video + Kling motion_control
   ├─ KIE AI           Seedance video (alternate provider)
   ├─ RunningHub       Wan Animate character replacement
   ├─ fal.ai           nano-banana images (background swap etc.)
   └─ Grok (xAI)       vision: recreation prompts, background describe
```

Registered worker providers (`worker.ts`): `fal`, `higgsfield`, `runninghub`,
`seedance` (Higgsfield generate_video), `kie`, `kling`.
Job kinds (`schema.ts`): `image`, `talking_head`, `motion_capture`, `seedance`.

The **UI only writes jobs as `queued`.** The **worker** is the only thing that
submits them to providers. No worker running ⇒ everything sits `queued` forever.

---

## 2. Run it

```bash
npm install                 # (see gotchas if better-sqlite3 fails to build)
cp .env.example .env.local  # then fill in keys (section 5)
npm run db:push             # create/patch the SQLite schema
npm run dev                 # ← starts BOTH the UI and the worker (supervised)
```

- `npm run dev` runs `scripts/dev-all.mjs`, which launches `next dev` **and** the
  worker together and auto-restarts the worker if it dies. Prefix logs: `[ui]` / `[worker]`.
- `npm run dev:ui` = UI only. `npm run worker` = worker only.
- **Run only ONE worker.** Two or more = they race for jobs ("ghost jobs").

UI at http://localhost:3000. Connect Higgsfield once via **Settings → Connect
Higgsfield MCP** (OAuth; token saved to `data/higgsfield-token.json`).

---

## 3. The pipelines (pages)

| Page | Route | What it does |
|------|-------|--------------|
| **Images** | `/images` | Original flow: Pinterest/upload references → Grok subject-swap → Higgsfield Soul stills → review |
| **Seedance** | `/seedance` | **Batch video recreation.** N videos × M outfits → stills → Seedance video per combo |
| **Seedance Direct** | `/seedance-direct` | Manual: drop image + video + prompt → Seedance. No pipeline |
| **Motion Capture** | `/motion-capture` | Guided motion-transfer batch. Two interchangeable engines (`/api/animate` `engine`): **RunningHub Wan Animate** or **Kling 3.0 motion_control** (Higgsfield). Pick frame, approve still, animate all |
| **Talking Head** | `/talking-head` | Stub (unbuilt) |

Additional pages present (added after the core video work — describe from code, not
covered in depth here): **`/instagram`** (RapidAPI feed browse + media download, see
`services/instagram.ts`), **`/formats`**, and prompt/style preset management
(**`/api/prompt-presets`**, **`/api/style-presets`**, `services/presets-store.ts`).

### Seedance batch flow (the main new thing)
`Setup → Videos → Background → Outfits → Stills → Seedance`

1. **Setup** — character, video provider (Higgsfield / KIE), aspect ratio.
2. **Videos** — upload many / paste IG links. Per video: extract 10 frames, pick
   one **or upload your own frame**. Duration auto-detected.
3. **Background** *(optional)* — pick a **saved background preset** (see §4) or
   upload one (described once, then frozen). Replaces each frame's own background.
4. **Outfits** — a shared list. `videos × outfits = variants`.
5. **Stills** — one card per variant. Grok writes the recreation prompt (pose from
   frame, identity from character, outfit from text, environment from background),
   Higgsfield renders the still, you approve. "Generate all stills" fires the matrix.
6. **Seedance** — approved still + its reference video → recreated video. Runs 3 in
   parallel (`VIDEO_CONCURRENCY`).

---

## 4. Key mechanics / design decisions

- **Recreation prompt** ([grok.ts](src/lib/services/grok.ts) `generateSwapPrompt`)
  emits a structured JSON schema. In code (`enforceRecreationConstraints`) we then
  **overwrite** critical fields regardless of what Grok returned:
  - `loras.character_lora` = the selected character's exact name.
  - **Banned terms scrubbed everywhere** — tattoos/skin-markings AND eyewear/glasses
    (`scrubBanned`). On Higgsfield the model reads the *whole* output as positive
    text, so even the word "tattoo" in a negative array backfires; hence we strip
    the words entirely and reinforce positively ("smooth clean unmarked skin").
- **Saved backgrounds** ([backgrounds table](src/lib/db/schema.ts)) — a location is
  described **once** by Grok (`describeBackground`), the text is **frozen**, and
  reused verbatim (and force-set into `environment.location` in code). This fixes
  backgrounds drifting between generations. ⚠️ `db:push` can WIPE this table (see gotchas).
- **Seedance video prompt** is a static template using Higgsfield's linked-element
  syntax `@[Image 1](image_1)` / `@[Video 1](video_1)`. No Grok call — the earlier
  Grok-authored "technical" prompts got taken literally and produced wireframe renders.
- **NSFW handling** — Seedance jobs auto-retry unlimited on filter (credits are
  refunded). Poll-timeout guard (45 min) prevents a wedged job blocking the queue.

---

## 5. Environment (`.env.local`, gitignored)

Required / important:
- `XAI_API_KEY` — Grok (all vision + prompts).
- Higgsfield — OAuth via the UI; `HIGGSFIELD_MCP_URL=https://mcp.higgsfield.ai`.
- `KIE_API_KEY`, `KIE_ENABLE_SAFETY_CHECKER` (→ `nsfw_checker`), `KIE_SEEDANCE_MODEL`.
- `RUNNINGHUB_API_KEY`, `RUNNINGHUB_WAN_APP_ID` + node ids, `RUNNINGHUB_INSTANCE_TYPE=plus`.
- `APIFY_TOKEN` — Instagram browsing/reel download (`apify/instagram-scraper` actor via `services/instagram.ts`'s `apifyRun`). Two prior RapidAPI providers (`instagram120`, then `instagram-scraper-stable-api`) were dropped in turn — the first got delisted from RapidAPI entirely, prompting the move to a real scraping platform instead of a RapidAPI reseller.
- `FFMPEG_PATH` — absolute path to ffmpeg.exe (frame extraction / video re-encode).
- `NODE_TLS_REJECT_UNAUTHORIZED=0` — this dev machine sits behind a TLS-intercepting
  proxy; without this, outbound HTTPS intermittently "fetch failed".
- `IMAGE_CONCURRENCY=3`, `VIDEO_CONCURRENCY=3`.

---

## 6. Provider quirks (hard-won)

- **Higgsfield `generate_video`**: model id is **`seedance_2_0`** (NOT the display
  name "Seedance 2.0"); media roles are **`image_references`** / **`video_references`**.
  It can intercept a submit with a "preset recommendation" (no job created) — the
  code auto-declines (`declined_preset_id`) and resubmits.
- **KIE Seedance**: fields are **`reference_image_urls`** / **`reference_video_urls`**,
  **`nsfw_checker`** (false = filtering OFF). Reference video must be pre-encoded to
  KIE's pixel budget (~[409600, 927408]) and ≤15s — done in `prepareVideoForKie`.
  Billing tells the truth: "with video" rate ≈ 25 cr/s, "no video" ≈ 41 cr/s.
- **RunningHub Wan Animate**: upload binary → run ai-app → poll query → download.
  Needs the **Plus (48G) instance** or it OOMs.
- **Kling 3.0 (`motion_control`, Higgsfield)**: alternate motion engine, chosen per
  batch via `/api/animate` `{ engine: "kling" }`. Takes **no prompt**; has
  `resolution` (720p/1080p) and `sceneControl` (`image` keeps the still's scene,
  `video` uses the driving video's). See `kling-provider.ts`.
- **Content eligibility**: Higgsfield's web-UI "Check eligibility" (protected/IP
  content) is **NOT available via the API** — confirmed against `show_medias`. We
  can't pre-check; only catch flags on output.

---

## 7. Code map

```
src/app/
  images/ seedance/ seedance-direct/ motion-capture/   pages
  api/
    jobs/              create/list/approve/reject/download jobs
    seedance/          enqueue a Seedance job (higgsfield|kie)
    animate/           enqueue a Wan Animate job (runninghub)
    backgrounds/       saved backgrounds CRUD + /describe
    references/        video intake, frame extraction, image upload
    grok/              swap-prompt, seedance-prompt
    higgsfield/        OAuth connect/callback, tools, characters
src/lib/
  services/  grok.ts higgsfield.ts higgsfield-oauth.ts kie.ts runninghub.ts
             references.ts background-backup.ts instagram.ts presets-store.ts slack.ts
  worker/    worker.ts job-runner.ts providers.ts
             higgsfield-provider.ts seedance-provider.ts kie-provider.ts
             runninghub-provider.ts kling-provider.ts fal-provider.ts
  db/        schema.ts index.ts
scripts/dev-all.mjs    supervised UI+worker launcher
backgrounds.seed.json  saved-background backup (auto-managed, committed)
```

---

## 8. Gotchas that will bite you

1. **Restart the worker after ANY worker-side change** (anything in `src/lib/worker/`
   or a service it imports). The worker caches code at startup. Many "it didn't
   work" moments were stale-worker.
2. **Only one worker at a time.** Kill strays; `npm run dev` owns the worker.
3. **`db:push` wipes hand-made data** — specifically saved `backgrounds` (no other
   source). ✅ **Now auto-protected**: `services/background-backup.ts` mirrors the
   table to `backgrounds.seed.json` (repo root, committed) on every save/delete and
   auto-restores it whenever the table is empty (on `GET /api/backgrounds`). So a
   push/reset can't lose them, and they travel with the repo.
4. **This dev machine's TLS proxy**: `git` needs `-c http.sslVerify=false`, `npm`
   needs `--strict-ssl=false`, Node needs `NODE_TLS_REJECT_UNAUTHORIZED=0`.
5. **better-sqlite3 on Node 24**: no prebuilt; if it fails, drop the matching
   prebuilt `.node` into `node_modules/better-sqlite3/build/Release/` (ABI v137 =
   Node 24), or use Node 22 LTS.
6. **Higgsfield linked-element tags** (`@[Image 1](image_1)`) auto-link through our
   API path, but NOT when pasted into Higgsfield's web UI — re-insert via @Elements there.

---

## 9. Git state

- Branch: **`seedance`** (off `main`). One commit with the whole pipeline.
- **Push is blocked** by GitHub permissions: the cached credentials are `Kreemy29`,
  which lacks write access to `3morad/mecha-ai` (403). To push: fix the credential
  (log in as an account with write access, or get added as a collaborator), then:
  ```bash
  git -c http.sslVerify=false push -u origin seedance
  ```
  (the `sslVerify=false` is required by the TLS proxy — see §8).

---

## 10. Open / next

- ✅ ~~Save-backgrounds JSON backup~~ — done (`background-backup.ts`, §8.3).
- `ip_detected` handling: surface Higgsfield's protected-content flag on cards and
  stop it looping through NSFW retries.
- Verify KIE result-download parsing end-to-end (uploads + submit confirmed).
- `talking-head` page is still a stub.
- Newer areas added after the core video work and NOT deeply documented here:
  **Kling** motion engine, **Instagram** browse/download (`/instagram`), **formats**
  (`/formats`), and prompt/style **preset stores**. Read the code in the files named
  in §7 before changing them.
- **ComfyUI Wan Animate workflow** (`OFMTech_BarbecueMotion.json`, external): in
  progress — goal is to source the animation background from the *reference image*
  instead of the *reference video*. The node to flip is `WanVideoAnimateEmbeds`'
  `bg_images` input, currently fed by `Get_background_image` (trace its `SetNode`).
