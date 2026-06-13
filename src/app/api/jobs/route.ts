import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50");

  let query = db
    .select()
    .from(schema.jobs)
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit);

  if (status) {
    query = query.where(
      eq(schema.jobs.status, status as typeof schema.jobs.status.enumValues[number])
    ) as typeof query;
  }

  const jobs = query.all();
  return NextResponse.json(jobs);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    kind,
    prompt,
    provider,
    providerModel,
    providerParams,
    characterId,
    batchId,
    referenceId,
  } = body;

  const result = db
    .insert(schema.jobs)
    .values({
      kind: kind || "image",
      prompt: prompt || "Test prompt",
      provider: provider || "dummy",
      providerModel: providerModel || null,
      providerParams: providerParams || null,
      characterId: characterId || null,
      batchId: batchId || null,
      referenceId: referenceId || null,
      status: "queued",
      attempts: 0,
      promptHistory: [],
    })
    .returning()
    .get();

  return NextResponse.json(result, { status: 201 });
}
