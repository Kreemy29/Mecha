import { NextResponse } from "next/server";
import {
  listCharacters,
  getConnectionStatus,
} from "@/lib/services/higgsfield";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET() {
  const status = getConnectionStatus();
  if (!status.hasToken) {
    return NextResponse.json(
      { error: "Not authenticated with Higgsfield", characters: [] },
      { status: 401 }
    );
  }

  try {
    const characters = await listCharacters();
    return NextResponse.json({ characters });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, characters: [] }, { status: 500 });
  }
}

// Sync Higgsfield characters into local DB
export async function POST() {
  const status = getConnectionStatus();
  if (!status.hasToken) {
    return NextResponse.json(
      { error: "Not authenticated with Higgsfield" },
      { status: 401 }
    );
  }

  try {
    const hfCharacters = await listCharacters();
    let synced = 0;

    for (const hfc of hfCharacters) {
      // Check if we already have this character linked
      const existing = db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.higgsFieldCharacterRef, hfc.id))
        .get();

      if (existing) {
        // Update name if it changed
        if (existing.name !== hfc.name) {
          db.update(schema.characters)
            .set({ name: hfc.name })
            .where(eq(schema.characters.id, existing.id))
            .run();
        }
        synced++;
      } else {
        // Create new local character
        db.insert(schema.characters)
          .values({
            name: hfc.name,
            featureProfile: `Higgsfield Soul character — imported from Higgsfield. Character ref: ${hfc.id}`,
            higgsFieldCharacterRef: hfc.id,
            baseImagePath: hfc.imageUrl || null,
          })
          .run();
        synced++;
      }
    }

    return NextResponse.json({
      message: `Synced ${synced} characters from Higgsfield`,
      total: hfCharacters.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
