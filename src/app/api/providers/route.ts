import { NextResponse } from "next/server";

// Models verified live via Higgsfield models_explore (machine names are exact).
// Higgsfield uses a credit system (not per-image USD), so costPerImage is null.
const providers = [
  {
    id: "higgsfield",
    name: "Higgsfield (MCP)",
    models: [
      {
        key: "soul_2",
        label: "Soul 2.0",
        description:
          "Realistic UGC, fashion editorial & character generation. Use with a trained Soul (soul_id) for identity consistency.",
        costPerImage: null,
        supportsSoul: true,
      },
      {
        key: "soul_cinematic",
        label: "Soul Cinema",
        description: "Cinema-grade stills & concept art. Supports Soul (soul_id).",
        costPerImage: null,
        supportsSoul: true,
      },
      {
        key: "nano_banana_pro",
        label: "Nano Banana Pro",
        description: "Google Gemini 3 Pro — ultimate quality, text & diagrams, up to 4K.",
        costPerImage: null,
        supportsSoul: false,
      },
      {
        key: "nano_banana_2",
        label: "Nano Banana 2",
        description: "Google — fast, next-gen high-quality images, up to 4K.",
        costPerImage: null,
        supportsSoul: false,
      },
      {
        key: "seedream_v5_lite",
        label: "Seedream 5.0 Lite",
        description: "ByteDance — visual reasoning & instruction-based editing.",
        costPerImage: null,
        supportsSoul: false,
      },
    ],
  },
  {
    id: "dummy",
    name: "Dummy (Testing)",
    models: [
      {
        key: "dummy",
        label: "Dummy Provider",
        description: "Fake provider for testing — completes in 5 seconds.",
        costPerImage: 0,
        supportsSoul: false,
      },
    ],
  },
];

export async function GET() {
  return NextResponse.json(providers);
}
