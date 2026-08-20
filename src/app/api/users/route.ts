import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  currentUser,
  deleteUser,
  isRole,
  listUsers,
  setPassword,
  updateUser,
} from "@/lib/services/auth";

// Account management. Admin-only: roles are assigned, never self-selected.

async function requireAdmin() {
  const me = await currentUser();
  if (!me) return { error: "Not signed in", status: 401 as const, me: null };
  if (!me.isAdmin) {
    return { error: "Admins only", status: 403 as const, me: null };
  }
  return { error: null, status: 200 as const, me };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  return NextResponse.json(listUsers());
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  try {
    const { username, name, role, password, isAdmin } = await request.json();
    if (!isRole(role)) {
      return NextResponse.json({ error: "Pick a valid role" }, { status: 400 });
    }
    const user = createUser({
      username,
      name,
      role,
      password,
      isAdmin: !!isAdmin,
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  try {
    const { id, name, role, isAdmin, password } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (role !== undefined && !isRole(role)) {
      return NextResponse.json({ error: "Pick a valid role" }, { status: 400 });
    }
    // An admin removing their own admin flag would lock the last door behind
    // them, so refuse it rather than leaving the install unmanageable.
    if (id === gate.me!.id && isAdmin === false) {
      return NextResponse.json(
        { error: "You can't remove your own admin access" },
        { status: 400 }
      );
    }
    if (password) setPassword(id, password);
    const user = updateUser(id, { name, role, isAdmin });
    return NextResponse.json(user);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (id === gate.me!.id) {
    return NextResponse.json(
      { error: "You can't delete your own account" },
      { status: 400 }
    );
  }
  deleteUser(id);
  return NextResponse.json({ ok: true });
}
