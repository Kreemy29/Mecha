import { NextRequest, NextResponse } from "next/server";
import { listAccounts, getActiveAccountId, removeAccount } from "@/lib/services/higgsfield-accounts";

// GET — every separately connected Higgsfield login (not workspaces within
// one login — see list_workspaces/select_workspace on the MCP server for that).
export async function GET() {
  const accounts = listAccounts();
  return NextResponse.json({
    accounts: accounts.map((a) => ({ id: a.id, label: a.label })),
    activeAccountId: getActiveAccountId(),
  });
}

// DELETE /api/higgsfield/accounts?id=...
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  removeAccount(id);
  return NextResponse.json({ ok: true });
}
