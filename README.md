# OneUp Studio

OneUp Media's content studio. One web app where the Instagram department
**researches trends, turns them into AI-made videos for every model, reviews
the work and hands it to marketing**, while it also tracks who worked when.

It has two halves:

- **The department pipeline**: Trends → Production → Drive → Marketing, with a
  time clock, timesheets, activity tracking and Telegram/email notifications
  at every hand-off.
- **The AI generation tools** the creators use to make the content: image
  recreation, Seedance video, motion transfer (Wan Animate / Kling), and
  methods saved from Higgsfield and Yapper.

> Developers: read [HANDOFF.md](HANDOFF.md) next (architecture, code map,
> gotchas, current state) and [DEPLOY.md](DEPLOY.md) for Render.

---

## Who uses it

| Role | What they do here |
|---|---|
| **Developer / AI Content Manager** (owner, admin) | Reviews trends, picks the method and creator for each one, reviews hand-ins, uploads the finished videos to Drive, manages accounts |
| **CEO** | Reviews and approves trends, sees everything (Team, Timesheets, Production) |
| **Trend Researcher** | Finds reels and carousels every day and explains why they'll go viral |
| **Content Creator** | Makes the videos for each model using the method, hands them in as Drive links |
| **Marketing Manager** | Gets told when finished content is in the Drive, ready to post |
| AI Artist, Meta Ads | Older roles, still supported (AI Artist can do production work) |

Accounts are created by an admin (**Settings → Accounts**). Nobody picks their
own role. Researchers and creators get a short menu with just their pages.

---

## The pipeline, step by step

```
 Researcher            Manager / CEO             Manager                 Creator                 Manager              Marketing
 ──────────            ─────────────             ───────                 ───────                 ───────              ─────────
 Trends page     ──►   approve / reject   ──►    Production:       ──►   makes one video   ──►   reviews each   ──►   "uploaded to
 add reels +           each trend                method + creator        per model, hands       video, puts           Drive", ready
 carousels                                       + models + example      each in as a           them in the           to post
                                                                         Drive link             shared Drive
 [Finished for         [Done reviewing]          [Send tasks]            [I'm finished]          [Uploaded to
  today] ─────►        ─────► Manager ──►        ─────► each creator     ─────► Manager           Drive] ─────► Marketing
  Manager + CEO
```

Every button in `[brackets]` sends a **Telegram message and/or email** to the
next person (see [Notifications](#notifications)).

### 1. Trend research (`Department → Trends`)

- Pick the **day** (arrows, date picker, or the week strip with counts and
  approved/waiting dots).
- Two sections: **Reels** and **Carousels**. For each find:
  **Instagram link**, **niche** (pick one or type a new one), the **models** it
  suits, and **why it will go viral**.
- Each card shows the **reel preview** (thumbnail, click to play), pulled free
  from Instagram's embed page. Posts whose owner blocks embedding show
  **Load preview**, which fetches that one post through Apify (a few credits,
  only on click).
- When the day's research is done, the researcher clicks **Finished for today**
  → the manager and the CEO are notified.

### 2. Review

- The manager or CEO **approves** or **rejects** each suggestion (a rejection
  carries a note the researcher sees). The researcher can edit a rejected one
  and it goes back to pending.
- When the **CEO** has gone through the day, she clicks **Done reviewing** → the
  manager gets "Content approved by the CEO: N approved, you can start working
  on it". (The manager reviewing doesn't need to notify themselves.)

### 3. Production planning (`Department → Production`)

- **Approved trends waiting for a method** are listed with their previews.
- The manager clicks **Assign** and picks:
  - the **method**: a generation saved on the **Methods** page (from Higgsfield
    or Yapper), with its prompt, output and **the reference photos/videos it
    was made from**;
  - the **content creator** and the **due date**;
  - the **models** to make it for, plus **one example** (which model it's for
    and a Drive link to it). The creator gets one item per *remaining* model.
- When everything is assigned, **Send tasks** messages each creator their new
  tasks. Each task then shows its stage: *Not sent yet → Sent → Finished →
  Uploaded*.

### 4. Making the content

- The creator sees **My tasks**: the original reel, the method (copyable
  prompt, output, references), the example, the notes, and one row per model.
- They make each video with the generation tools, upload it to Drive and hand
  it in with **Hand in** (a Drive link). Items can be updated until approved.
- Once every model is handed in, they click **I'm finished** → the manager gets
  the list of Drive links.

### 5. Review and delivery

- The manager **approves** or **rejects** each model's video (with a note).
- They put the finished videos in the shared Drive folder and click
  **Uploaded to Drive** with the folder link → the marketing managers are told
  it's ready to post.

---

## Time, breaks and tracking

| Page | Who | What |
|---|---|---|
| **Time clock** (`Department`) | Everyone | Clock in, **start / end break**, clock out. Today's worked and break time, and a log of every punch |
| Top bar clock | Everyone | Running total while working, **Break / Resume** button, link to the Time clock |
| **My hours** | Everyone | Today / this week / this month, hours per day chart, every session with its breaks |
| **Timesheets** | Manager, CEO | Everyone's hours per day for a week or month, totals and averages, **CSV export** for payroll |
| **Team** | Manager, CEO | One day in detail per person: sessions and breaks, active / idle / away time, top apps and sites, a full timeline, and how much of their work was approved |

Rules:

- **Breaks don't count** as worked time anywhere, and nothing is tracked
  during a break.
- Researchers and creators must be **clocked in (and not on a break)** to
  submit work.
- Forgot to clock out? A session with no activity for **2 hours** closes itself
  at the last sign of life (flagged "auto"). A break left running **4 hours**
  ends the day at the moment the break started.

### Activity tracking, permission first

Like Insightful, but **nothing is recorded until the person agrees**. On
**Settings → Work tracker** each person reads exactly what is and isn't
collected and clicks **Allow tracking** (they can withdraw any time). The
server refuses activity from anyone who hasn't agreed to the current wording.

Two trackers, both connected with a personal **tracker key** from that page:

- **OneUp desktop tracker (Windows)**: a small tray app (no install, uses the
  PowerShell built into Windows). Records the program in front (CapCut,
  Photoshop…) and its window title, plus idle time. Asks permission again on
  the computer the first time it runs.
- **Chrome extension**: records the website and page title of the tab in front.

Only while clocked in and not on a break. **Never**: screenshots, keystrokes,
anything typed, page contents, or anything outside working hours.

---

## Notifications

Each person sets a **work email** and **Telegram username** (admin on
**Settings → Accounts**, or themselves on **Settings → My profile**).

- **Telegram**: everyone clicks **Connect Telegram** on My profile once and
  presses **Start** in the bot (Telegram only lets a bot message people who
  started it). If Start does nothing (Telegram in a browser), the page shows
  the `/start <code>` message to paste into the bot instead.
- **Email**: sent through Gmail.

The bot token and Gmail login can be pasted straight into
**Settings → Accounts → Notifications** (stored in the app, shown masked), so
no hosting dashboard access is needed. After each hand-off button, the app
says who was notified and names anyone it couldn't reach.

---

## The generation tools

| Page | What it does |
|---|---|
| **Instagram** | Save Instagram accounts (tagged by model and niche), browse their reels, save clips, send them to requests or recreation |
| **Requests** | Work queues (Meta Ads / Reels): a clip handed to someone to produce, with a model, a format and a comment thread |
| **Formats** | Weekly board of "winning formats" (reference reels), each with a method and per-model quotas |
| **Images** | Pinterest / upload references → Grok writes a subject-swap prompt → Higgsfield Soul renders stills → review, redo with notes, download |
| **Seedance** | Batch video recreation: N videos × M outfits → a still per combination → Seedance video from still + reference video |
| **Motion capture** | Motion transfer: pick a frame, approve the still, animate with Wan Animate (RunningHub) or Kling 3.0 (Higgsfield) |
| **Methods** | Your Higgsfield and Yapper generation history (prompt, settings, references, output). **Save** the good ones so they can be assigned in Production |
| **Characters / Presets** | The AI personas, and saved prompt / outfit / hair / makeup / background presets |

---

## Running it

```bash
npm install
# create .env.local with your keys (the full list is in DEPLOY.md, section 3)
npm run dev                  # UI + background worker together → http://localhost:3000
```

- Node **22** (not 24: `better-sqlite3` has no prebuilt binary for 24).
- `ffmpeg` on the PATH (or `FFMPEG_PATH`).
- The first visit creates the admin account (asks for `SETUP_TOKEN` if set).
- **Settings → Connections** connects Higgsfield (sign-in in the browser) and
  Yapper (API key; needs a paid Yapper plan).

Production runs on Render as one Docker service with a persistent disk. See
[DEPLOY.md](DEPLOY.md).

---

## Built with

Next.js 16 (App Router) + React 19 + TypeScript · Tailwind 4 + shadcn/ui on Base
UI, styled with the **OneUp Insights** design system (dark) · SQLite via
better-sqlite3 + Drizzle · a Node worker with p-queue for generation jobs ·
Higgsfield (MCP), KIE, RunningHub, fal, Grok/Gemini, Apify, Yapper · Telegram
Bot API and Gmail (nodemailer) for notifications.

All generated content depicts fictional AI personas.
