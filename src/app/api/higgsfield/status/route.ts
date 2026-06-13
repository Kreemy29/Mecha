import { NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/services/higgsfield";

export async function GET() {
  const status = getConnectionStatus();
  return NextResponse.json(status);
}
