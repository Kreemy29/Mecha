import { NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/services/yapper";

export async function GET() {
  const status = getConnectionStatus();
  return NextResponse.json(status);
}
