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

import type { OracleExplanation } from "./types";

export async function generateProse(
  explanation: OracleExplanation,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const prompt = buildPrompt(explanation);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: { type: string; text: string }[];
  };

  return data.content[0].text;
}

function buildPrompt(e: OracleExplanation): string {
  // Serialize config with bigints as strings
  const configStr = JSON.stringify(
    e.config,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  const resolvedStr = JSON.stringify(e.resolved, null, 2);
  const componentsStr = e.pricingPath.components
    .map(
      (c) =>
        `  ${c.name} (${c.role}): ${c.source}`,
    )
    .join("\n");
  const derivedStr = JSON.stringify(e.pricingPath.derived, null, 2);

  return `You are writing a plain-English explanation of a DeFi oracle for a risk/due-diligence memo. You are NOT computing the price — that has already been verified deterministically. Your job is to explain the structured facts below in clear, precise English.

## Oracle
- Address: ${e.address}
- Chain: ${e.chainId === 1 ? "Ethereum mainnet" : `Chain ${e.chainId}`}
- Contract: ${e.contractName}
- Family: ${e.family}
- Creator: ${e.creator ? e.creator.address : "unknown"}
- Verified: ${e.verified ? "YES — recomputed price matches live call exactly" : "NO — MISMATCH"}
- Live price: ${e.livePrice.toString()}

## Formula
${e.pricingPath.formula}

## Components
${componentsStr}

## Derived metadata
${derivedStr}

## Resolved dependencies
${resolvedStr}

## Raw config
${configStr}

## Standing caveats for this oracle family
${e.pricingPath.caveats.map((c, i) => `${i + 1}. ${c}`).join("\n")}

---

Write exactly four paragraphs with these headings:

**How it prices** — Describe what data sources feed into the price and the formula in plain English. Name the actual tokens/feeds by their resolved labels. Explain what a zero/disabled slot means in practice.

**What it assumes** — What trust assumptions does this oracle embed? Which external systems must behave correctly?

**What it doesn't check** — What failure modes are structurally invisible to this oracle? What could go wrong that it would not detect?

**Who can change what** — Is this oracle immutable? Can any party update feeds, change parameters, or pause it? Who deployed it?

Be precise and specific to THIS oracle's actual configuration. Do not be generic. Reference the actual resolved names, actual decimal values, actual active/disabled slots.`;
}
