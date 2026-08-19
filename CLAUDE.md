# Oracle Explainer

Paste an oracle contract address, get a plain-English explanation of how it prices,
what it assumes, and what it doesn't check.

Full design rationale and the Morpho adapter reference: @oracle-explainer-spec.md

## Non-negotiable rules

1. **The LLM never computes a price.** Adapters compute pricing paths deterministically
   in code. The model only turns structured facts into prose. A fluent wrong answer is
   worse than no answer here — the output is intended for due-diligence memos.

2. **Every explanation is gated on a verification check.** Recompute `price()` (or the
   family's equivalent entrypoint) from parsed config and compare against the live
   on-chain call. Exact match required. On mismatch, render the config dump and the
   resolved dependencies, and state plainly that the pricing path could not be verified.
   Never render a narrative for an unverified path.

3. **Resolve dependencies before explaining.** A raw address in a config field carries no
   information. One hop of enrichment (`symbol`, `description`, `decimals`, `name`,
   `owner`) does most of the explanatory work; two hops reaches the underlying aggregator
   and its controller, which is where the trust story lives.

4. **Read the libraries, not just the entrypoint.** Zero-address and other sentinel
   behaviour is where these contracts hide their real semantics. See the spec for the
   canonical example.

## Stack

Next.js, viem, Etherscan v2 multichain API (single key, all chains), Anthropic API for
the prose layer only.

## Conventions

- One adapter per oracle family, in `src/adapters/<family>.ts`.
- Every adapter ships with at least one golden fixture pinned to a block number.
- Adapters are pure: config in, pricing path out. No network calls inside an adapter.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
