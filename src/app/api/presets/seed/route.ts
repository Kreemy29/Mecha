import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

const seedPresets = [
  {
    name: "Outdoor Portrait",
    description: "Natural light portraits in outdoor settings — parks, streets, rooftops",
    type: "image" as const,
    searchPromptSeed: "aesthetic outdoor portrait photography natural light golden hour",
  },
  {
    name: "OOTD Selfie",
    description: "Outfit of the day mirror selfies and full-body fashion shots",
    type: "image" as const,
    searchPromptSeed: "outfit of the day selfie mirror shot fashion streetwear",
  },
  {
    name: "Mirror Selfie",
    description: "Casual mirror selfies with aesthetic backgrounds",
    type: "image" as const,
    searchPromptSeed: "aesthetic mirror selfie casual pose bedroom bathroom",
  },
  {
    name: "Coffee Shop",
    description: "Cozy cafe vibes — reading, sipping, candid lifestyle moments",
    type: "image" as const,
    searchPromptSeed: "coffee shop aesthetic cozy cafe lifestyle portrait candid",
  },
  {
    name: "Fitness",
    description: "Gym and activewear content — workout poses, athleisure",
    type: "image" as const,
    searchPromptSeed: "fitness aesthetic gym activewear workout pose athleisure",
  },
];

export async function POST() {
  const existing = db.select().from(schema.presets).all();
  if (existing.length > 0) {
    return NextResponse.json(
      { message: "Presets already seeded", count: existing.length },
      { status: 200 }
    );
  }

  for (const preset of seedPresets) {
    db.insert(schema.presets).values({ ...preset, active: true }).run();
  }

  return NextResponse.json(
    { message: "Seeded presets", count: seedPresets.length },
    { status: 201 }
  );
}
