/**
 * Chainlink AggregatorV3Interface adapter.
 *
 * The family covers two shapes that are indistinguishable by ABI:
 *
 *   1. A proxy (EACAggregatorProxy) that forwards reads to a swappable
 *      `aggregator()`. The proxy address is the stable one consumers hold; the
 *      aggregator behind it is what actually holds the answer.
 *   2. The aggregator itself, read directly.
 *
 * Verification follows the same discipline as the Morpho adapter: establish
 * where the number is supposed to come from by parsing config, go read it
 * there, and require an exact match against the entrypoint. For a proxy that
 * means the aggregator's answer must equal the proxy's. For a bare aggregator
 * it means the round the feed calls latest must return the answer the feed
 * reports as latest — a weaker claim, and labelled as such.
 *
 * Note what this adapter deliberately does NOT claim: that the feed is
 * operated by Chainlink. Implementing this interface is a shape, not a
 * provenance. Separating the two needs owner inspection, which is surfaced as
 * a fact rather than a conclusion.
 */

import { type Address, type PublicClient, zeroAddress } from "viem";
import type {
  RawConfig,
  ResolvedDependencies,
  PricingPath,
  PricingComponent,
  FormulaExplanation,
} from "../lib/types";
import {
  buildHumanPrice,
  scaleDown,
  shortAddress,
  parseFeedPair,
} from "../lib/format";

function isZero(addr: unknown): boolean {
  return (
    typeof addr !== "string" ||
    addr === zeroAddress ||
    addr.toLowerCase() === "0x" + "0".repeat(40)
  );
}

/**
 * An independent second read of the same answer — the verification gate.
 * Null when neither route was available: access-controlled aggregators reject
 * direct reads, and not every feed serves historical rounds.
 *
 * Null must never be coerced into a number. A fabricated value would either
 * fake a match or fake a mismatch, and both are worse than reporting that the
 * check could not be run.
 */
export interface ChainlinkCrossCheck {
  method: "aggregator" | "round-replay";
  value: bigint;
}

export interface ChainlinkLiveValues {
  /** answer from the entrypoint's latestRoundData() */
  answer: bigint;
  roundId: bigint;
  updatedAt: bigint;
  /** The independent read, or null when none could be made. */
  crossCheck: ChainlinkCrossCheck | null;
  /** chain time the read was taken at, for the staleness figure */
  blockTimestamp: bigint;
}

/**
 * Whether the pricing path can be verified at all. The pipeline routes to the
 * described tier when this is false rather than reporting a mismatch — "could
 * not check" and "checked and disagreed" are different findings, and conflating
 * them accuses the parser of a bug that isn't there.
 */
export function chainlinkCrossCheckAvailable(
  live: ChainlinkLiveValues,
): boolean {
  return live.crossCheck !== null;
}

export function chainlinkAdapter(
  config: RawConfig,
  resolved: ResolvedDependencies,
  live: ChainlinkLiveValues,
): PricingPath {
  const decimals = Number(config.decimals ?? 8);
  const description =
    typeof config.description === "string" ? config.description : null;
  const aggregator = config.aggregator;
  const hasAggregator = !isZero(aggregator);

  // Whichever independent read succeeded. With none, fall back to the answer
  // itself so the number stays honest — the pipeline has already routed this
  // to the described tier, so it is never presented as a passed verification.
  const recomputedPrice = live.crossCheck?.value ?? live.answer;

  const components: PricingComponent[] = [
    {
      name: "answer",
      role: "numerator",
      value: live.answer,
      source: `latestRoundData().answer = ${live.answer.toString()} (${decimals} decimals)`,
    },
    {
      name: "roundId",
      role: "numerator",
      value: live.roundId,
      source: `latestRoundData().roundId = ${live.roundId.toString()}`,
    },
    {
      name: "updatedAt",
      role: "numerator",
      value: live.updatedAt,
      source: `latestRoundData().updatedAt = ${live.updatedAt.toString()} (${ageInWords(live.blockTimestamp - live.updatedAt)} ago)`,
    },
  ];

  if (live.crossCheck) {
    components.push({
      name: "cross-check",
      role: "numerator",
      value: live.crossCheck.value,
      source:
        live.crossCheck.method === "aggregator"
          ? `${resolved.aggregator?.label ?? shortAddress(String(aggregator))}.latestRoundData().answer = ${live.crossCheck.value.toString()}`
          : `getRoundData(${live.roundId.toString()}).answer = ${live.crossCheck.value.toString()}`,
    });
  }

  const formula = hasAggregator
    ? `answer = aggregator(${shortAddress(String(aggregator))}).latestRoundData().answer`
    : `answer = latestRoundData().answer  [this contract is the aggregator]`;

  const humanPrice = buildHumanPrice({
    raw: live.answer,
    exponent: decimals,
    baseSymbol: parseFeedPair(description).base,
    quoteSymbol: parseFeedPair(description).quote,
    basis:
      `A Chainlink-style feed reports its answer scaled by its own decimals(), ` +
      `which is ${decimals} here, so the raw answer was divided by 10^${decimals}.`,
  });

  const staleSeconds = Number(live.blockTimestamp - live.updatedAt);

  const derived: Record<string, unknown> = {
    decimals,
    description,
    isProxy: hasAggregator,
    lastUpdatedSecondsAgo: staleSeconds,
    lastUpdatedAgo: ageInWords(live.blockTimestamp - live.updatedAt),
    crossCheckMethod: live.crossCheck?.method ?? null,
    verificationStrength:
      live.crossCheck?.method === "aggregator"
        ? "proxy answer matched against the underlying aggregator"
        : live.crossCheck?.method === "round-replay"
          ? "latest answer matched against a replay of its own round id"
          : "no independent read was possible — the answer could not be confirmed",
    owner: resolved.owner?.address ?? config.owner ?? null,
    aggregatorOwner: resolved.aggregator?.aggregatorOwner ?? null,
  };

  return {
    formula,
    formulaExplanation: explainChainlink({
      config,
      resolved,
      live,
      decimals,
      description,
      hasAggregator,
      humanPriceStatement: humanPrice.statement,
      staleSeconds,
    }),
    recomputedPrice,
    humanPrice,
    components,
    caveats: CHAINLINK_CAVEATS,
    derived,
  };
}

function ageInWords(seconds: bigint): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return "an unknown time";
  if (s < 120) return `${s} seconds`;
  if (s < 7200) return `${Math.floor(s / 60)} minutes`;
  if (s < 172800) return `${Math.floor(s / 3600)} hours`;
  return `${Math.floor(s / 86400)} days`;
}

function explainChainlink(ctx: {
  config: RawConfig;
  resolved: ResolvedDependencies;
  live: ChainlinkLiveValues;
  decimals: number;
  description: string | null;
  hasAggregator: boolean;
  humanPriceStatement: string;
  staleSeconds: number;
}): FormulaExplanation {
  const { config, resolved, live, decimals, description, hasAggregator } = ctx;
  const pair = parseFeedPair(description);
  const subject = description
    ? `the price of ${description}`
    : `a price with no on-chain description`;

  const summary =
    `This is a push feed: it stores a number that off-chain reporters write to it, and reading ` +
    `it just returns whatever was written last. Nothing is computed on demand. It currently ` +
    `reports ${subject}, to ${decimals} decimal places.`;

  const steps: string[] = [];

  if (hasAggregator) {
    const addr = shortAddress(String(config.aggregator));
    // Naming it twice ("0x7d4E…6Fb5 (0x7d4E…6Fb5)") is what happens when the
    // aggregator publishes no description to label it with.
    const aggLabel = resolved.aggregator?.label
      ? `${resolved.aggregator.label} (${addr})`
      : addr;
    steps.push(
      `The address you pasted is a proxy. It holds no price of its own — it forwards every read ` +
        `to the aggregator it currently points at, ${aggLabel}. Consumers hold the proxy address ` +
        `because it stays constant; the aggregator behind it can be replaced.`,
    );
  } else {
    steps.push(
      `The address you pasted is the aggregator itself, not a proxy in front of one. There is no ` +
        `indirection between the stored answer and the read.`,
    );
  }

  steps.push(
    `The stored answer is ${live.answer.toString()} at ${decimals} decimals, which reads as ` +
      `${scaleDown(live.answer, decimals)}` +
      (pair.base && pair.quote ? ` ${pair.quote} per ${pair.base}` : "") +
      `. That number came from round ${live.roundId.toString()}.`,
  );

  steps.push(
    `It was written ${ageInWords(live.blockTimestamp - live.updatedAt)} ago. A push feed only ` +
      `moves when its operators publish a new round — on a heartbeat, or when the price drifts ` +
      `past a deviation threshold. Neither of those parameters is stored on-chain, so how fresh ` +
      `this number is meant to be cannot be read from the contract.`,
  );

  const notes: string[] = [
    `Implementing this interface is a shape, not a provenance claim. A genuine Chainlink DON ` +
      `feed and a project-run push oracle that anyone can write to look identical from the ABI. ` +
      `What separates them is who controls the aggregator` +
      (resolved.aggregator?.aggregatorOwner
        ? `, and here that owner is ${shortAddress(resolved.aggregator.aggregatorOwner)} — check ` +
          `whether that is a Chainlink multisig or a single key before trusting it.`
        : resolved.owner?.address
          ? `, and here the feed's owner is ${shortAddress(resolved.owner.address)}.`
          : `, which could not be read from this contract.`),
  ];

  if (hasAggregator) {
    notes.push(
      `Because the aggregator is swappable, whoever owns the proxy can redirect it to a different ` +
        `source without the address you pasted ever changing. Anything trusting this address is ` +
        `trusting that owner not to.`,
    );
  }

  notes.push(`Rescaled, the current answer reads: ${ctx.humanPriceStatement}.`);

  return { summary, steps, notes };
}

/**
 * Read everything the adapter needs. The only network-touching part.
 */
export async function readChainlinkLiveValues(
  client: PublicClient,
  address: Address,
  config: RawConfig,
): Promise<ChainlinkLiveValues> {
  const abi = [
    {
      type: "function",
      name: "latestRoundData",
      inputs: [],
      outputs: [
        { name: "roundId", type: "uint80" },
        { name: "answer", type: "int256" },
        { name: "startedAt", type: "uint256" },
        { name: "updatedAt", type: "uint256" },
        { name: "answeredInRound", type: "uint80" },
      ],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "getRoundData",
      inputs: [{ name: "_roundId", type: "uint80" }],
      outputs: [
        { name: "roundId", type: "uint80" },
        { name: "answer", type: "int256" },
        { name: "startedAt", type: "uint256" },
        { name: "updatedAt", type: "uint256" },
        { name: "answeredInRound", type: "uint80" },
      ],
      stateMutability: "view",
    },
  ] as const;

  type Round = readonly [bigint, bigint, bigint, bigint, bigint];

  const [latest, block] = await Promise.all([
    client.readContract({ address, abi, functionName: "latestRoundData" }) as Promise<Round>,
    client.getBlock(),
  ]);

  const aggregator = config.aggregator;
  let crossCheck: ChainlinkCrossCheck | null = null;

  // Preferred: read the aggregator the proxy points at. Strongest check —
  // it confirms we identified the actual source of the number.
  if (!isZero(aggregator)) {
    try {
      const agg = (await client.readContract({
        address: aggregator as Address,
        abi,
        functionName: "latestRoundData",
      })) as Round;
      crossCheck = { method: "aggregator", value: agg[1] };
    } catch {
      // AccessControlledOffchainAggregator rejects direct reads from callers
      // that are not whitelisted, which is the common case on mainnet feeds.
    }
  }

  // Fallback: ask the entrypoint to replay the round it just called latest.
  // Weaker, since it is the same contract — but it exercises a different code
  // path, and on a proxy it forwards through to the aggregator the proxy is
  // itself whitelisted to read.
  if (!crossCheck) {
    try {
      const replay = (await client.readContract({
        address,
        abi,
        functionName: "getRoundData",
        args: [latest[0]],
      })) as Round;
      crossCheck = { method: "round-replay", value: replay[1] };
    } catch {
      // Historical rounds are not always retrievable. Leave null; the pipeline
      // reports the path as unverifiable rather than inventing a comparison.
    }
  }

  return {
    answer: latest[1],
    roundId: latest[0],
    updatedAt: latest[3],
    crossCheck,
    blockTimestamp: block.timestamp,
  };
}

/** The live value the verification gate compares the recomputation against. */
export function chainlinkEntrypointValue(live: ChainlinkLiveValues): bigint {
  return live.answer;
}

const CHAINLINK_CAVEATS: string[] = [
  "This contract does not know its own heartbeat or deviation threshold. Those are off-chain operator parameters, so a consumer cannot read from the feed how stale its answer is allowed to get.",
  "Nothing here rejects a stale answer. A feed whose operators stop publishing keeps returning its last value indefinitely, with only updatedAt to reveal it.",
  "Aggregators enforce minAnswer/maxAnswer bounds internally. During an extreme move the feed can pin at that bound and keep reporting it as a valid answer — the LUNA precedent.",
  "An answer is a single number with no confidence interval. Consumers cannot tell whether the reporters agreed closely or barely at all.",
];
