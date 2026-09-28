import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { requireClockedIn } from "@/lib/services/clock-gate";
import { can } from "@/lib/roles";
import { isDate } from "@/lib/services/trends";
import { publicOrigin } from "@/lib/request-origin";
import { notifyConfig } from "@/lib/services/notify";
import {
  dayMarks,
  researchFinished,
  reviewFinished,
  sendTasks,
  taskFinished,
  taskUploaded,
} from "@/lib/services/workflow";
import { listTasks } from "@/lib/services/production";

const appOrigin = (request: NextRequest) => process.env.APP_URL?.replace(/\/$/, "") || publicOrigin(request);

// GET ?date=YYYY-MM-DD → who marked that day done, how many tasks are unsent,
// and whether Telegram/email are configured.
export async function GET(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const date = request.nextUrl.searchParams.get("date");
  return NextResponse.json({
    marks: isDate(date) ? dayMarks(date) : [],
    unsentTasks: listTasks({}).filter((t) => !t.sentAt).length,
    channels: notifyConfig(),
  });
}

// { action, date?, taskId?, url? } — see services/workflow.ts for each step.
export async function POST(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { action, date, taskId, url } = await request.json();
  const origin = appOrigin(request);

  try {
    switch (action) {
      case "research_done": {
        if (!can.suggestTrends(user)) return NextResponse.json({ error: "Researchers only" }, { status: 403 });
        const clock = requireClockedIn(user);
        if (clock) return clock;
        if (!isDate(date)) return NextResponse.json({ error: "date required" }, { status: 400 });
        return NextResponse.json({ ok: true, notified: await researchFinished(user, date, origin) });
      }
      case "review_done": {
        if (!can.reviewTrends(user)) return NextResponse.json({ error: "Reviewers only" }, { status: 403 });
        if (!isDate(date)) return NextResponse.json({ error: "date required" }, { status: 400 });
        return NextResponse.json({ ok: true, notified: await reviewFinished(user, date, origin) });
      }
      case "send_tasks": {
        if (!can.manageProduction(user)) return NextResponse.json({ error: "Managers only" }, { status: 403 });
        return NextResponse.json({ ok: true, ...(await sendTasks(origin)) });
      }
      case "task_finished": {
        const clock = requireClockedIn(user);
        if (clock) return clock;
        return NextResponse.json({ ok: true, notified: await taskFinished(user, Number(taskId), origin) });
      }
      case "task_uploaded": {
        if (!can.manageProduction(user)) return NextResponse.json({ error: "Managers only" }, { status: 403 });
        return NextResponse.json({ ok: true, notified: await taskUploaded(user, Number(taskId), String(url ?? "")) });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
