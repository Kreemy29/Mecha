# Deploying OneUp to Render

One Docker web service running both the UI and the job worker, with one
persistent disk. See "Why one service" at the bottom.

## 1. Create the service

Render → **New → Web Service** → connect this repo.

| Setting | Value |
|---|---|
| Language / Runtime | **Docker** (it will find the `Dockerfile`) |
| Branch | the branch you pushed |
| Instance type | **Standard (2 GB)** — not Starter, see below |
| Instances | **1** (never more, see below) |

## 2. Add the disk

Render → your service → **Disks → Add Disk**

| Setting | Value |
|---|---|
| Mount path | `/data` |
| Size | 20 GB to start (videos accumulate; nothing prunes them yet) |

Everything that must survive a deploy lives here: the SQLite database, the
Higgsfield OAuth token, and all uploaded/generated media. `scripts/start-all.mjs`
symlinks `./data` and `./storage` onto it at boot.

## 3. Environment variables

**Required**

| Key | Value |
|---|---|
| `SETUP_TOKEN` | A long random string you invent. **Set this before the first deploy** — see step 5. |
| `XAI_API_KEY` | Grok |
| `HIGGSFIELD_MCP_URL` | `https://mcp.higgsfield.ai` |
| `DATABASE_PATH` | `/data/data/mecha.db` |
| `IMAGE_CONCURRENCY` | `3` |
| `VIDEO_CONCURRENCY` | `3` |

`FFMPEG_PATH` and `NODE_ENV` are already set in the Dockerfile.

**Per feature — only if you use it**

- Gemini prompts: `GEMINI_API_KEY`, `GEMINI_MODEL` (`gemini-3.5-flash`)
- KIE video: `KIE_API_KEY`, `KIE_SEEDANCE_MODEL`, `KIE_ENABLE_SAFETY_CHECKER`
- Wan Animate: `RUNNINGHUB_API_KEY`, `RUNNINGHUB_WAN_APP_ID`, the node ids, `RUNNINGHUB_INSTANCE_TYPE=plus`
- Instagram browsing/download: `RAPIDAPI_KEY`, `RAPIDAPI_INSTAGRAM_HOST`

**Do NOT set `NODE_TLS_REJECT_UNAUTHORIZED=0`.** That is a workaround for the
dev machine's TLS-intercepting proxy. In production it disables certificate
verification on every outbound HTTPS call.

## 4. First boot

The database is created automatically — all tables are made at runtime with
`CREATE TABLE IF NOT EXISTS`, so there is no migration step and no `db:push`.

## 5. Claim the admin account

An empty database means the first person to open `/login` becomes the founding
admin. On a public URL that is a land-grab, which is what `SETUP_TOKEN` is for:
with it set, the first-run form asks for the code, and only you have it.

1. Open the service URL — you get the first-run screen.
2. Enter your setup code, name, username, password.
3. You are now the admin. Go to **/admin** and create the agency's accounts:
   the two owners, the meta ads person, the marketing manager, and any other AI
   artists (leave "admin" unchecked for them).

After the first account exists, `/api/auth/setup` refuses forever, so the code
cannot be reused.

## 6. Reconnect Higgsfield

**Settings → Connect Higgsfield MCP.** OAuth derives its redirect URI from the
request origin, so it adapts to the Render URL by itself. The token is written
to the disk and survives restarts.

---

## Things worth knowing

**Why one service.** The UI and the worker share a filesystem: they communicate
through `data/mecha.db` (SQLite/WAL) plus `storage/`. A Render disk attaches to
exactly one service, so a web + background-worker split would require replacing
SQLite with Postgres and `storage/` with object storage — a real refactor.

**Instances must stay at 1.** Two instances means two workers racing for the
same jobs. The disk makes it impossible anyway; do not fight it.

**Standard, not Starter.** Video downloads read whole files into memory, and
with `VIDEO_CONCURRENCY=3` plus an ffmpeg subprocess, 512 MB will OOM.

**Deploys restart the service.** That is inherent to disks. In-flight jobs are
picked up again on boot — the worker resumes anything left `running`/`polling`.

**Still open:** `requireUser()` guards the account, request, comment and
winning-format routes. The rest of the API sits behind the proxy's optimistic
cookie check, which stops casual access but not a forged cookie. Worth
hardening before this is shared widely.
