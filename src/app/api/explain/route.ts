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

    // Every tier except the opaque one gets prose. What changes between tiers
    // is the prompt: a verified path gets the pricing memo, everything else
    // gets the descriptive prompt, which is forbidden from claiming a
    // mechanism it could not check.
    if (explanation.tier !== "opaque") {
      try {
        explanation.prose = await generateProse(explanation);
      } catch (err) {
        // Prose generation failure is non-fatal — the deterministic
        // explanation is already on the page without it. But record why:
        // a silently blank section is indistinguishable from one that was
        // never attempted, which made this undiagnosable in production.
        const reason = err instanceof Error ? err.message : String(err);
        explanation.proseError = reason;
        console.error("Prose generation failed:", reason);
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

    // A throttled or unreachable block explorer is worth retrying; a genuine
    // pipeline fault is not. Distinguish them so the client can tell.
    const transient =
      typeof err === "object" &&
      err !== null &&
      (err as { transient?: boolean }).transient === true;

    return NextResponse.json(
      { error: message, retryable: transient },
      { status: transient ? 503 : 500 },
    );
  }
}
