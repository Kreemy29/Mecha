import { NextRequest, NextResponse } from "next/server";
import { requireUser, type PublicUser } from "@/lib/services/auth";
import { can } from "@/lib/roles";
import {
  addTrendComment,
  deleteTrendComment,
  getTrend,
  getTrendComment,
  type Trend,
} from "@/lib/services/trends";
import { listTasks } from "@/lib/services/production";

// The comment thread under a trend. Anyone who can see the trend can take
// part: reviewers and managers, the researcher who found it, and any creator
// with a production task for it.
function canSeeTrend(user: PublicUser, trend: Trend): boolean {
  if (can.reviewTrends(user) || can.manageProduction(user)) return true;
  if (trend.createdById === user.id) return true;
  return listTasks({ trendId: trend.id, assigneeId: user.id }).length > 0;
}

// { trendId, body } → the new comment
export async function POST(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { trendId, body } = await request.json();
  const trend = getTrend(Number(trendId));
  if (!trend || !canSeeTrend(user, trend)) {
    return NextResponse.json({ error: "Trend not found" }, { status: 404 });
  }
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return NextResponse.json({ error: "Write something first" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "Keep it under 2000 characters" }, { status: 400 });
  return NextResponse.json(addTrendComment(trend.id, user.id, text), { status: 201 });
}

// ?id= → delete your own comment (managers can delete any)
export async function DELETE(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const comment = getTrendComment(Number(request.nextUrl.searchParams.get("id")));
  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (comment.authorId !== user.id && !can.manageProduction(user)) {
    return NextResponse.json({ error: "You can only delete your own comments" }, { status: 403 });
  }
  deleteTrendComment(comment.id);
  return NextResponse.json({ ok: true });
}
