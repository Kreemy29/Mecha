import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { driveConfigured, listFolder, listRoots, outputsCheck } from "@/lib/services/google-drive";

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
