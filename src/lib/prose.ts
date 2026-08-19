/**
 * LLM prose generation.
 * Takes structured adapter output and produces four paragraphs:
 * 1. How it prices
 * 2. What it assumes
 * 3. What it doesn't check
 * 4. Who can change what
 *
 * The LLM never computes a price — it only turns structured facts into English.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { OracleExplanation } from "./types";

/**
 * Claude Opus 5. Two things about this model shape the call below:
 *
 * 1. Thinking is on by default, and max_tokens caps thinking + response text
 *    together. The old 1500 budget would have been consumed by thinking and
 *    truncated the prose mid-paragraph, so the budget is generous here.
 * 2. It writes longer by default than earlier models, which is why the prompt
 *    carries an explicit length instruction rather than relying on the
 *    "four paragraphs" framing alone.
 *
 * Effort is medium deliberately: this task is turning already-verified facts
 * into English, not deriving anything. The arithmetic happened in the adapter.
 */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;

/**
 * Oracle due-diligence reads as security-adjacent — the descriptive prompt for
 * an unrecognised contract asks what could not be established and what a
 * reviewer should check by hand, and a real address (GemUsdcOracle) tripped the
 * cyber classifier on exactly that. Server-side fallbacks re-run a declined
 * request on another model in the same call; cyber-category refusals route to
 * Opus 4.8. "default" lets Anthropic pick per category rather than pinning a
 * model that will need migrating later.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export async function generateProse(
  explanation: OracleExplanation,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // An opaque contract has nothing to write about.
  if (explanation.tier === "opaque") {
    throw new Error("No source available — prose would have nothing to describe");
  }

  const prompt =
    explanation.tier === "verified-path"
      ? buildPrompt(explanation)
      : buildDescriptivePrompt(explanation);

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium" },
      betas: [FALLBACK_BETA],
      // SDK typings lag this parameter; the wire shape is a bare string.
      ...({ fallbacks: "default" } as Record<string, unknown>),
      messages: [{ role: "user", content: prompt }],
    });

    // A refusal here means the whole chain declined, fallback included.
    if (response.stop_reason === "refusal") {
      throw new Error(
        `Model declined to answer (${response.stop_details?.category ?? "no category"}). ` +
          `This is a false positive on security-adjacent language, not a judgement ` +
          `about the contract — the structured analysis below is unaffected.`,
      );
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (!text.trim()) {
      throw new Error(
        `Model returned no text (stop_reason: ${response.stop_reason})`,
      );
    }

    return text;
  } catch (err) {
    // Surface the reason rather than a bare failure — the route records this
    // and the UI shows it, which is how the retired-model-ID bug was found.
    if (err instanceof Anthropic.NotFoundError) {
      throw new Error(`Model "${MODEL}" not found: ${err.message}`);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("ANTHROPIC_API_KEY was rejected");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("Rate limited by the Anthropic API — retry shortly");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
    }
    throw err;
  }
}

function buildPrompt(e: OracleExplanation): string {
  const path = e.pricingPath;
  if (!path) throw new Error("buildPrompt requires a verified pricing path");
  // Serialize config with bigints as strings
  const configStr = JSON.stringify(
    e.config,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  const resolvedStr = JSON.stringify(e.resolved, null, 2);
  const componentsStr = path.components
    .map(
      (c) =>
        `  ${c.name} (${c.role}): ${c.source}`,
    )
    .join("\n");
  const derivedStr = JSON.stringify(path.derived, null, 2);

  return `You are writing a plain-English explanation of a DeFi oracle for a risk/due-diligence memo. You are NOT computing the price — that has already been verified deterministically. Your job is to explain the structured facts below in clear, precise English.

## Oracle
- Address: ${e.address}
- Chain: ${e.chainId === 1 ? "Ethereum mainnet" : `Chain ${e.chainId}`}
- Contract: ${e.contractName}
- Family: ${e.family}
- Creator: ${e.creator ? e.creator.address : "unknown"}
- Verified: ${e.verified ? "YES — recomputed price matches live call exactly" : "NO — MISMATCH"}
- Live price (raw): ${e.livePrice?.toString() ?? "n/a"}
- Live price (rescaled, computed deterministically — use this figure verbatim, do not recompute it): ${
    path.humanPrice
      ? `${path.humanPrice.statement} (${path.humanPrice.basis})`
      : "not derivable — the scaling exponent could not be recovered, so do not state a decimal price"
  }

## Formula
${path.formula}

## Plain-English reading of the formula (already shown to the reader — do not repeat it verbatim)
${path.formulaExplanation.summary}
${path.formulaExplanation.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}
${path.formulaExplanation.notes.map((x) => `- ${x}`).join("\n")}

## Components
${componentsStr}

## Derived metadata
${derivedStr}

## Resolved dependencies
${resolvedStr}

## Raw config
${configStr}

## Standing caveats for this oracle family
${path.caveats.map((c, i) => `${i + 1}. ${c}`).join("\n")}
${buildUnderlyingSection(e)}
---

Write exactly four paragraphs with these headings:

**How it prices** — Describe what data sources feed into the price and the formula in plain English. Name the actual tokens/feeds by their resolved labels. Explain what a zero/disabled slot means in practice.

**What it assumes** — What trust assumptions does this oracle embed? Which external systems must behave correctly?

**What it doesn't check** — What failure modes are structurally invisible to this oracle? What could go wrong that it would not detect?

**Who can change what** — Is this oracle immutable? Can any party update feeds, change parameters, or pause it? Who deployed it?

The reader is already shown the step-by-step formula walkthrough above, so do not restate it move for move — go past it to the implications. Never state a price figure other than the rescaled one given above, and never do arithmetic of your own.

Be precise and specific to THIS oracle's actual configuration. Do not be generic. Reference the actual resolved names, actual decimal values, actual active/disabled slots. If there are underlying oracles, explain how each one computes its price and how the wrapper selects between them.

Keep each paragraph to roughly 3-5 sentences. This sits in a risk memo next to the structured tables above it, so density matters more than completeness — say the thing that would change a reviewer's decision and stop. No preamble, no closing summary paragraph.`;
}

function buildUnderlyingSection(e: OracleExplanation): string {
  if (!e.underlyingOracles || Object.keys(e.underlyingOracles).length === 0) {
    return "";
  }

  const sections: string[] = ["\n## Underlying oracles"];
  for (const [role, oracle] of Object.entries(e.underlyingOracles)) {
    const oracleConfigStr = JSON.stringify(
      oracle.config,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
    const oracleResolvedStr = JSON.stringify(oracle.resolved, null, 2);
    const inner = oracle.pricingPath;
    const oracleComponentsStr = (inner?.components ?? [])
      .map((c) => `  ${c.name} (${c.role}): ${c.source}`)
      .join("\n");

    sections.push(`
### ${role.toUpperCase()} oracle — ${oracle.contractName} (${oracle.address})
Family: ${oracle.family}
Verified: ${oracle.verified ? "YES" : "NO"}

Formula: ${inner?.formula ?? "not computed"}

Components:
${oracleComponentsStr}

Derived: ${JSON.stringify(inner?.derived ?? {}, null, 2)}

Resolved dependencies:
${oracleResolvedStr}

Config:
${oracleConfigStr}

Caveats:
${(inner?.caveats ?? []).map((c, i) => `${i + 1}. ${c}`).join("\n")}
`);
  }

  return sections.join("\n");
}

/**
 * The prompt for every tier that is not a verified pricing path.
 *
 * This is a different job from the memo prompt above, and the difference is
 * the point: there is no verified arithmetic here, so the model is given only
 * observable facts and is forbidden from describing a pricing mechanism. The
 * useful output is orientation — what this is, what it touches, what a human
 * still has to go and check by hand.
 */
function buildDescriptivePrompt(e: OracleExplanation): string {
  const configStr = JSON.stringify(
    e.config,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  const resolvedStr = JSON.stringify(e.resolved, null, 2);

  return `You are helping someone doing due diligence on a DeFi oracle. This address could NOT be verified: no adapter was able to recompute its output and match it against the live contract.

## What is known
- Address: ${e.address}
- Chain: ${e.chainId === 1 ? "Ethereum mainnet" : `Chain ${e.chainId}`}
- Contract name: ${e.contractName}
- ABI fingerprint suggests family: ${e.family}
- Why it could not be verified: ${e.limitation ?? "unknown"}
- Deployed by: ${e.creator ? e.creator.address : "unknown"}

## Readable configuration
${configStr}

## Resolved dependency addresses
${resolvedStr}

## Deterministic description already shown to the reader
${e.explanation.summary}
${e.explanation.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}
${e.explanation.notes.map((x) => `- ${x}`).join("\n")}

---

Write exactly three short paragraphs with these headings:

**What this contract is** — Identify it from its name, its ABI shape and its dependencies. If the name or the resolved dependencies strongly suggest a specific protocol or a specific asset pair, say so and say what the evidence is. Distinguish clearly between what the chain told us and what you are inferring.

**What it depends on** — Walk the resolved dependency addresses and say what each one appears to be. This is the most useful section: a raw address carries no information, and naming what sits behind each one is the work.

**What still has to be checked by hand** — Be specific and actionable about what a reviewer needs to do to close the gap: which function to read, which source file to open, which owner address to look up. Name the actual limitation that blocked verification.

CRITICAL CONSTRAINTS — these override any instinct to be helpful:
- Do NOT explain how this contract computes its price. That was not verified and any account you give of it would be a guess. If you find yourself writing "it multiplies", "it divides", "it reads the price from", stop.
- Do NOT state a price figure or do any arithmetic.
- Do NOT reassure the reader that the oracle is safe, sound, standard, or fine. You have no basis for that.
- Where you are inferring rather than reading, mark it plainly ("the name suggests", "this looks like").
- If the honest answer to a section is that very little could be established, say that briefly rather than padding it.

Keep each paragraph to roughly 3-5 sentences. No preamble and no closing summary.`;
}
