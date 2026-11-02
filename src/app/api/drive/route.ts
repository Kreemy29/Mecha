import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { createFolder, driveConfigured, listFolder, listRoots, outputsCheck } from "@/lib/services/google-drive";

// Browse Google Drive for the Images page.
//   GET                 → { configured, email, roots }  (Shared Drives + shared folders)
//   GET ?folder=<id>    → { entries }                   (subfolders + images inside)
//   GET ?check=<id>     → { ok, reason }                (can outputs be saved there?)
export async function GET(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const sp = request.nextUrl.searchParams;
  const { ok, email } = driveConfigured();
  if (!ok) {
    return NextResponse.json({ configured: false, email: null, roots: [], error: "Google Drive isn't set up on the server." });
  }
  try {
    const folder = sp.get("folder");
    if (folder) return NextResponse.json({ entries: await listFolder(folder) });
    const check = sp.get("check");
    if (check) return NextResponse.json(await outputsCheck(check));
    return NextResponse.json({ configured: true, email, roots: await listRoots() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

// { parentId, name } → { id, name }: a new folder inside parentId.
export async function POST(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const { parentId, name } = await request.json();
  if (typeof parentId !== "string" || !parentId) {
    return NextResponse.json({ error: "parentId required" }, { status: 400 });
  }
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) return NextResponse.json({ error: "Give the folder a name" }, { status: 400 });
  if (clean.length > 200) return NextResponse.json({ error: "That name is too long" }, { status: 400 });
  try {
    return NextResponse.json(await createFolder(parentId, clean), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
