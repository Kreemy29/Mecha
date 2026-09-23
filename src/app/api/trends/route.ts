import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { requireClockedIn } from "@/lib/services/clock-gate";
import { can } from "@/lib/roles";
import {
  createTrend,
  deleteTrend,
  getTrend,
  isDate,
  listTrends,
  reviewTrend,
  trendCountsByDate,
  updateTrend,
  validateTrendInput,
  type ReviewStatus,
  type TrendInput,
} from "@/lib/services/trends";
import { taskCountForTrend } from "@/lib/services/production";
import { rememberTaxonomy } from "@/lib/services/instagram";

// Researchers see only their own suggestions; reviewers and the production
// manager see everyone's.
const seesAll = (u: Parameters<typeof can.reviewTrends>[0]) =>
  can.reviewTrends(u) || can.manageProduction(u);

// GET ?date=YYYY-MM-DD            → that day's suggestions
// GET ?from=…&to=…&counts=1        → per-day counts for the calendar strip
// GET ?status=approved             → e.g. the production board's intake
export async function GET(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const sp = request.nextUrl.searchParams;
  const createdBy = seesAll(user) ? undefined : user.id;

  if (sp.get("counts")) {
    const from = sp.get("from");
    const to = sp.get("to");
    if (!isDate(from) || !isDate(to)) {
      return NextResponse.json({ error: "from/to required" }, { status: 400 });
    }
    return NextResponse.json(trendCountsByDate(from, to, createdBy));
  }

  const status = sp.get("status") as ReviewStatus | null;
  return NextResponse.json(
    listTrends({
      date: isDate(sp.get("date")) ? sp.get("date")! : undefined,
      from: isDate(sp.get("from")) ? sp.get("from")! : undefined,
      to: isDate(sp.get("to")) ? sp.get("to")! : undefined,
      status: status && ["pending", "approved", "rejected"].includes(status) ? status : undefined,
      createdBy,
    })
  );
}

export async function POST(request: NextRequest) {
  const { user, deny } = await requireUser({ allow: can.suggestTrends });
  if (deny) return deny;
  const clock = requireClockedIn(user);
  if (clock) return clock;

  const input = (await request.json()) as TrendInput;
  const invalid = validateTrendInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  // New niches become options on the Instagram page (and next time here).
  if (input.niche?.trim()) rememberTaxonomy("niche", input.niche);
  return NextResponse.json(createTrend(input, user.id), { status: 201 });
}

// { id, review: "approved" | "rejected" | "pending", note }  → review
// { id, ...TrendInput }                                      → edit own
export async function PATCH(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const body = await request.json();
  const trend = getTrend(Number(body.id));
  if (!trend) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.review) {
    if (!can.reviewTrends(user)) {
      return NextResponse.json({ error: "Your role can't review trends" }, { status: 403 });
    }
    if (!["approved", "rejected", "pending"].includes(body.review)) {
      return NextResponse.json({ error: "Bad review status" }, { status: 400 });
    }
    if (body.review !== "approved" && taskCountForTrend(trend.id) > 0) {
      return NextResponse.json(
        { error: "This trend already has production tasks — delete those first" },
        { status: 409 }
      );
    }
    return NextResponse.json(reviewTrend(trend.id, body.review, body.note ?? null, user.id));
  }

  const own = trend.createdById === user.id;
  if (!own && !can.manageProduction(user)) {
    return NextResponse.json({ error: "Not your suggestion" }, { status: 403 });
  }
  if (trend.status === "approved") {
    return NextResponse.json({ error: "Approved suggestions are locked" }, { status: 409 });
  }
  const clock = requireClockedIn(user);
  if (clock) return clock;
  const invalid = validateTrendInput(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (body.niche?.trim()) rememberTaxonomy("niche", body.niche);
  return NextResponse.json(updateTrend(trend.id, body));
}

export async function DELETE(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const trend = getTrend(Number(request.nextUrl.searchParams.get("id")));
  if (!trend) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const own = trend.createdById === user.id && trend.status !== "approved";
  if (!own && !can.manageProduction(user)) {
    return NextResponse.json({ error: "You can't delete this" }, { status: 403 });
  }
  if (taskCountForTrend(trend.id) > 0) {
    return NextResponse.json(
      { error: "This trend has production tasks — delete those first" },
      { status: 409 }
    );
  }
  deleteTrend(trend.id);
  return NextResponse.json({ ok: true });
}
