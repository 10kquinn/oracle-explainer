/**
 * Plain-English description for addresses no adapter can verify.
 *
 * The project rule is that a pricing narrative requires a verified pricing
 * path, and that rule holds here. What this file produces is deliberately a
 * different kind of text: it says what the contract is, what it exposes, and
 * what its dependencies resolve to, and it says explicitly that how it arrives
 * at a price was not established. It never describes a mechanism.
 *
 * The distinction matters because the failure mode being guarded against is a
 * fluent explanation that happens to be wrong. Describing observable facts
 * cannot be wrong in that way; describing an unverified mechanism can.
 */

import type {
  FormulaExplanation,
  OracleFamily,
  RawConfig,
  ResolvedDependencies,
} from "./types";
import { shortAddress } from "./format";

const FAMILY_ENTRYPOINT: Record<string, string> = {
  chainlink: "latestRoundData()",
  euler: "getQuote(uint256,address,address)",
  aave: "getAssetPrice(address)",
  morpho: "price()",
  "morpho-meta": "price()",
};

const FAMILY_NOTE: Record<string, string> = {
  euler:
    "Euler EVK oracles price a named pair on demand — getQuote takes the amount, the base token " +
    "and the quote token as arguments. There is no single number to read and check, so verifying " +
    "one requires choosing a pair to ask about. That is why this address stops at a description.",
  aave:
    "Aave's oracle prices whatever asset you name — getAssetPrice takes an address. Without an " +
    "asset to ask about there is no single entrypoint value to recompute, so this address stops " +
    "at a description.",
};

/**
 * Build the explanation shown when no adapter ran, or when one ran and its
 * recomputation did not match.
 */
export function describeUnverified(opts: {
  address: string;
  contractName: string;
  family: OracleFamily;
  config: RawConfig;
  resolved: ResolvedDependencies;
  /** Set when an adapter ran but disagreed with the live call. */
  mismatch?: { recomputed: bigint; live: bigint } | null;
}): FormulaExplanation {
  const { address, contractName, family, config, resolved, mismatch } = opts;

  const entrypoint = FAMILY_ENTRYPOINT[family];
  const known = family !== "unknown";

  const summary = mismatch
    ? `${contractName} was recognised as a ${family} oracle and its pricing path was ` +
      `reconstructed, but the reconstruction does not match what the contract actually returns. ` +
      `That means the config was misread somewhere, so nothing below should be treated as an ` +
      `explanation of how this oracle prices.`
    : known
      ? `${contractName} is a verified contract that looks like a ${family} oracle — it exposes ` +
        `${entrypoint}. There is no adapter that can recompute that entrypoint yet, so what ` +
        `follows describes what the contract exposes rather than how it arrives at a price.`
      : `${contractName} is a verified contract, but its ABI does not match any oracle family ` +
        `this tool knows how to compute. What follows is what could be read off it directly. ` +
        `How it prices was not established and is not guessed at below.`;

  const steps: string[] = [];

  // What the entrypoint is.
  if (entrypoint) {
    steps.push(
      `Its price entrypoint is ${entrypoint}. That is the call a consumer makes to get a number ` +
        `out of this contract.`,
    );
  } else {
    const getters = Object.keys(config).slice(0, 8);
    steps.push(
      getters.length > 0
        ? `It exposes these readable values: ${getters.join(", ")}${
            Object.keys(config).length > getters.length ? ", and others" : ""
          }. None of them matches a known oracle entrypoint signature.`
        : `It exposes no zero-argument view getters, so there was nothing to read without ` +
          `knowing what arguments to supply.`,
    );
  }

  // What it depends on — the part that carries the real information.
  const deps = Object.entries(resolved).filter(
    ([, r]) => r.address !== "0x0000000000000000000000000000000000000000",
  );

  if (deps.length > 0) {
    steps.push(
      `It holds ${deps.length} contract address${deps.length === 1 ? "" : "es"} in its ` +
        `configuration, which is where its actual dependencies are: ` +
        deps
          .map(([slot, r]) => {
            const name = r.label ?? r.symbol ?? "no on-chain name";
            return `${slot} → ${shortAddress(r.address)} (${name})`;
          })
          .join("; ") +
        `. Following those addresses is the fastest way to work out what this oracle really ` +
        `depends on.`,
    );
  } else {
    steps.push(
      `It exposes no address-typed configuration, so its dependencies — if it has any — are not ` +
        `discoverable from its getters. They may be hardcoded in the bytecode or passed as ` +
        `arguments at call time.`,
    );
  }

  const owners = deps
    .map(([, r]) => r.owner)
    .filter((o): o is `0x${string}` => Boolean(o));
  if (owners.length > 0) {
    steps.push(
      `At least one dependency has an owner (${[...new Set(owners)]
        .map(shortAddress)
        .join(", ")}), meaning some part of this setup is controllable by a key or a multisig ` +
        `rather than fixed at deployment.`,
    );
  }

  const notes: string[] = [];

  if (mismatch) {
    notes.push(
      `The reconstruction produced ${mismatch.recomputed.toString()} but the contract returned ` +
        `${mismatch.live.toString()}. A mismatch is a parsing failure on this tool's side, not ` +
        `evidence that the oracle is broken.`,
    );
  }

  if (FAMILY_NOTE[family]) notes.push(FAMILY_NOTE[family]);

  notes.push(
    `Everything above is read directly off the chain and is accurate. What is missing is the ` +
      `arithmetic — no explanation of how this contract turns its inputs into its output is ` +
      `offered, because none could be checked against the live contract. For a due-diligence ` +
      `read, treat this as a starting map rather than an answer, and go to the source at ` +
      `${shortAddress(address)}.`,
  );

  return { summary, steps, notes };
}

/**
 * The explanation for a contract whose source is not published. There is
 * nothing to describe beyond provenance.
 */
export function describeOpaque(opts: {
  address: string;
  reason: string;
}): FormulaExplanation {
  return {
    summary:
      `This contract's source code is not published, so there is nothing to read. No ` +
      `explanation is offered, and decompiler output is not a substitute for one.`,
    steps: [
      `The address ${shortAddress(opts.address)} either has no verified source on the block ` +
        `explorer, or the explorer could not be reached: ${opts.reason}`,
      `Without an ABI there is no way to know what the contract exposes, which means no getters ` +
        `to read, no dependencies to resolve, and no entrypoint to check.`,
    ],
    notes: [
      `If this address is in production use somewhere, the absence of published source is itself ` +
        `the finding worth recording.`,
    ],
  };
}
