import { NextRequest, NextResponse } from "next/server";
import { listAccounts, getActiveAccountId, removeAccount } from "@/lib/services/yapper-accounts";

// GET — every connected Yapper API key.
export async function GET() {
  const accounts = listAccounts();
  return NextResponse.json({
    accounts: accounts.map((a) => ({ id: a.id, label: a.label })),
    activeAccountId: getActiveAccountId(),
  });
}

// DELETE /api/yapper/accounts?id=...
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  removeAccount(id);
  return NextResponse.json({ ok: true });
}
