import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { requireClockedIn } from "@/lib/services/clock-gate";
import { can } from "@/lib/roles";
import { isDate } from "@/lib/services/trends";
import {
  createTask,
  deleteTask,
  itemAssignee,
  listMethods,
  listTasks,
  reviewItem,
  submitItem,
  type TaskInput,
} from "@/lib/services/production";

// GET ?methods=1              → saved Higgsfield + Yapper generations to pick from
// GET ?mine=1                 → the signed-in creator's tasks
// GET ?assignee=&date=&open=1 → the manager's board
export async function GET(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const sp = request.nextUrl.searchParams;

  if (sp.get("methods")) {
    if (!can.manageProduction(user)) {
      return NextResponse.json({ error: "Managers only" }, { status: 403 });
    }
    return NextResponse.json(listMethods());
  }

  const date = sp.get("date");
  const mine = sp.get("mine") || !can.viewAllProduction(user);
  return NextResponse.json(
    listTasks({
      assigneeId: mine ? user.id : Number(sp.get("assignee")) || undefined,
      dueDate: isDate(date) ? date : undefined,
      openOnly: !!sp.get("open"),
    })
  );
}

export async function POST(request: NextRequest) {
  const { user, deny } = await requireUser({ allow: can.manageProduction });
  if (deny) return deny;
  try {
    const input = (await request.json()) as TaskInput;
    if (!input.trendId || !input.assigneeId) {
      return NextResponse.json({ error: "Pick a trend and a creator" }, { status: 400 });
    }
    if (!isDate(input.dueDate)) {
      return NextResponse.json({ error: "Pick a due date" }, { status: 400 });
    }
    if (!Array.isArray(input.models)) {
      return NextResponse.json({ error: "Pick the models" }, { status: 400 });
    }
    return NextResponse.json(createTask(input, user.id), { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// { itemId, action: "submit", driveUrl }        → creator hands in
// { itemId, action: "approve" | "reject", note } → manager reviews
export async function PATCH(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { itemId, action, driveUrl, note } = await request.json();
  const assignee = itemAssignee(Number(itemId));
  if (assignee === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    if (action === "submit") {
      if (assignee !== user.id) {
        return NextResponse.json({ error: "This isn't your task" }, { status: 403 });
      }
      const clock = requireClockedIn(user);
      if (clock) return clock;
      const url = String(driveUrl || "").trim();
      try {
        new URL(url);
      } catch {
        return NextResponse.json({ error: "Paste the Drive link" }, { status: 400 });
      }
      submitItem(Number(itemId), url);
    } else if (action === "approve" || action === "reject") {
      if (!can.manageProduction(user)) {
        return NextResponse.json({ error: "Managers only" }, { status: 403 });
      }
      reviewItem(Number(itemId), action === "approve" ? "approved" : "rejected", note ?? null, user.id);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { deny } = await requireUser({ allow: can.manageProduction });
  if (deny) return deny;
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteTask(id);
  return NextResponse.json({ ok: true });
}
