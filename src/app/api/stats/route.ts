import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const statusCounts = db
    .select({
      status: schema.jobs.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.jobs)
    .groupBy(schema.jobs.status)
    .all();

  const providerCounts = db
    .select({
      provider: schema.jobs.provider,
      status: schema.jobs.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.jobs)
    .groupBy(schema.jobs.provider, schema.jobs.status)
    .all();

  const totalCost = db
    .select({
      total: sql<number>`coalesce(sum(cost_estimate), 0)`,
    })
    .from(schema.jobs)
    .get();

  return NextResponse.json({
    statusCounts,
    providerCounts,
    totalCost: totalCost?.total || 0,
    dailyCostCap: parseFloat(process.env.DAILY_COST_CAP || "50"),
  });
}
