import { NextRequest, NextResponse } from "next/server";
import { explainOracle } from "@/lib/pipeline";
import { generateProse } from "@/lib/prose";

// Allow up to 60s on Vercel Pro, 10s on Hobby
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, chainId = 1 } = body as {
      address: string;
      chainId?: number;
    };

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        { error: "address is required" },
        { status: 400 },
      );
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: "Invalid address format" },
        { status: 400 },
      );
    }

    const explanation = await explainOracle(address, chainId);

    // Generate prose only if verified
    if (explanation.verified) {
      try {
        explanation.prose = await generateProse(explanation);
      } catch (err) {
        // Prose generation failure is non-fatal — the structured data is still valuable
        console.error("Prose generation failed:", err);
      }
    }

    // Serialize bigints for JSON response
    return NextResponse.json(
      JSON.parse(
        JSON.stringify(explanation, (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Pipeline error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
