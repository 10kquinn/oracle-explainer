/**
 * Morpho MorphoChainlinkOracleV2 adapter.
 *
 * Pure function: takes raw config + resolved dependencies, produces a
 * deterministic pricing path. No network calls.
 *
 * Handles the sentinel behaviour from VaultLib and ChainlinkDataFeedLib:
 * - Zero-address vault returns 1 (identity for shares→assets conversion)
 * - Zero-address feed returns 1 (identity for price multiplication)
 * - Zero-address feed decimals returns 0
 */

import { zeroAddress, type Address } from "viem";
import type {
  RawConfig,
  ResolvedDependencies,
  PricingPath,
  PricingComponent,
} from "../lib/types";

const ZERO = zeroAddress;

function isZero(addr: unknown): boolean {
  if (typeof addr !== "string") return true;
  return (
    addr === ZERO ||
    addr === "0x" ||
    addr.toLowerCase() === "0x" + "0".repeat(40)
  );
}

function bigintOrThrow(val: unknown, name: string): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") return BigInt(val);
  if (typeof val === "string") return BigInt(val);
  throw new Error(`Expected bigint for ${name}, got ${typeof val}: ${val}`);
}

/**
 * Compute the Morpho MorphoChainlinkOracleV2 pricing path.
 *
 * price() = SCALE_FACTOR
 *   * BASE_VAULT.getAssets(BASE_VAULT_CONVERSION_SAMPLE)
 *   * BASE_FEED_1.getPrice()
 *   * BASE_FEED_2.getPrice()
 *   / (QUOTE_VAULT.getAssets(QUOTE_VAULT_CONVERSION_SAMPLE)
 *      * QUOTE_FEED_1.getPrice()
 *      * QUOTE_FEED_2.getPrice())
 *
 * With the sentinel rule: zero-address vault/feed returns 1.
 */
export function morphoAdapter(
  config: RawConfig,
  resolved: ResolvedDependencies,
  liveValues: MorphoLiveValues,
): PricingPath {
  const scaleFactor = bigintOrThrow(config.SCALE_FACTOR, "SCALE_FACTOR");
  const baseVaultConversionSample = bigintOrThrow(
    config.BASE_VAULT_CONVERSION_SAMPLE,
    "BASE_VAULT_CONVERSION_SAMPLE",
  );
  const quoteVaultConversionSample = bigintOrThrow(
    config.QUOTE_VAULT_CONVERSION_SAMPLE,
    "QUOTE_VAULT_CONVERSION_SAMPLE",
  );

  const baseVault = config.BASE_VAULT as Address;
  const quoteVault = config.QUOTE_VAULT as Address;
  const baseFeed1 = config.BASE_FEED_1 as Address;
  const baseFeed2 = config.BASE_FEED_2 as Address;
  const quoteFeed1 = config.QUOTE_FEED_1 as Address;
  const quoteFeed2 = config.QUOTE_FEED_2 as Address;

  // Resolve each component value using sentinel rules
  const baseVaultAssets = isZero(baseVault)
    ? 1n
    : liveValues.baseVaultAssets;
  const baseFeed1Price = isZero(baseFeed1)
    ? 1n
    : liveValues.baseFeed1Price;
  const baseFeed2Price = isZero(baseFeed2)
    ? 1n
    : liveValues.baseFeed2Price;
  const quoteVaultAssets = isZero(quoteVault)
    ? 1n
    : liveValues.quoteVaultAssets;
  const quoteFeed1Price = isZero(quoteFeed1)
    ? 1n
    : liveValues.quoteFeed1Price;
  const quoteFeed2Price = isZero(quoteFeed2)
    ? 1n
    : liveValues.quoteFeed2Price;

  // Build components
  const components: PricingComponent[] = [];

  components.push({
    name: "SCALE_FACTOR",
    role: "numerator",
    value: scaleFactor,
    source: `constructor-computed constant (${scaleFactor.toString()})`,
  });

  components.push(
    makeComponent("BASE_VAULT", baseVault, baseVaultAssets, "numerator", resolved, baseVaultConversionSample),
    makeComponent("BASE_FEED_1", baseFeed1, baseFeed1Price, "numerator", resolved),
    makeComponent("BASE_FEED_2", baseFeed2, baseFeed2Price, "numerator", resolved),
    makeComponent("QUOTE_VAULT", quoteVault, quoteVaultAssets, "denominator", resolved, quoteVaultConversionSample),
    makeComponent("QUOTE_FEED_1", quoteFeed1, quoteFeed1Price, "denominator", resolved),
    makeComponent("QUOTE_FEED_2", quoteFeed2, quoteFeed2Price, "denominator", resolved),
  );

  // Compute price using mulDiv: SCALE_FACTOR * numerator / denominator
  const numerator = scaleFactor * baseVaultAssets * baseFeed1Price * baseFeed2Price;
  const denominator = quoteVaultAssets * quoteFeed1Price * quoteFeed2Price;

  // mulDiv: (a * b) / c with full precision (Solidity's Math.mulDiv)
  const recomputedPrice = numerator / denominator;

  // Build formula string
  const formula = buildFormula(
    config,
    resolved,
    { baseVaultAssets, baseFeed1Price, baseFeed2Price, quoteVaultAssets, quoteFeed1Price, quoteFeed2Price },
    baseVaultConversionSample,
  );

  // Derive decimals from SCALE_FACTOR
  const derived = deriveFromScaleFactor(
    scaleFactor,
    config,
    resolved,
  );

  return {
    formula,
    recomputedPrice,
    components,
    caveats: MORPHO_CAVEATS,
    derived,
  };
}

function makeComponent(
  name: string,
  addr: unknown,
  value: bigint,
  role: "numerator" | "denominator",
  resolved: ResolvedDependencies,
  conversionSample?: bigint,
): PricingComponent {
  if (isZero(addr)) {
    return {
      name,
      role,
      value: 1n,
      source: "identity (zero address — disabled)",
    };
  }

  const res = resolved[name];
  const label = res?.label ?? (addr as string);
  const isVault = name.includes("VAULT");

  let source: string;
  if (isVault && conversionSample !== undefined) {
    source = `${label}.convertToAssets(${conversionSample.toString()}) = ${value.toString()}`;
  } else {
    source = `${label}.latestRoundData() = ${value.toString()}`;
  }

  return { name, role, value, source };
}

function buildFormula(
  config: RawConfig,
  resolved: ResolvedDependencies,
  values: {
    baseVaultAssets: bigint;
    baseFeed1Price: bigint;
    baseFeed2Price: bigint;
    quoteVaultAssets: bigint;
    quoteFeed1Price: bigint;
    quoteFeed2Price: bigint;
  },
  baseVaultConversionSample: bigint,
): string {
  const parts: { num: string[]; den: string[] } = { num: [], den: [] };

  parts.num.push(`SCALE_FACTOR`);

  if (!isZero(config.BASE_VAULT)) {
    const label = resolved.BASE_VAULT?.label ?? "BASE_VAULT";
    parts.num.push(`${label}.convertToAssets(${baseVaultConversionSample})`);
  }
  if (!isZero(config.BASE_FEED_1)) {
    const label = resolved.BASE_FEED_1?.label ?? "BASE_FEED_1";
    parts.num.push(`${label}.price`);
  }
  if (!isZero(config.BASE_FEED_2)) {
    const label = resolved.BASE_FEED_2?.label ?? "BASE_FEED_2";
    parts.num.push(`${label}.price`);
  }

  if (!isZero(config.QUOTE_VAULT)) {
    const label = resolved.QUOTE_VAULT?.label ?? "QUOTE_VAULT";
    parts.den.push(`${label}.convertToAssets(...)`);
  }
  if (!isZero(config.QUOTE_FEED_1)) {
    const label = resolved.QUOTE_FEED_1?.label ?? "QUOTE_FEED_1";
    parts.den.push(`${label}.price`);
  }
  if (!isZero(config.QUOTE_FEED_2)) {
    const label = resolved.QUOTE_FEED_2?.label ?? "QUOTE_FEED_2";
    parts.den.push(`${label}.price`);
  }

  const numStr = parts.num.join(" * ");
  const denStr = parts.den.length > 0 ? parts.den.join(" * ") : "1";

  return `price = ${numStr} / ${denStr}`;
}

/**
 * Infer token decimals from SCALE_FACTOR.
 *
 * SCALE_FACTOR = 10^(36 + dQuote + dQF1 + dQF2 - dBase - dBF1 - dBF2)
 *                * quoteVaultConversionSample / baseVaultConversionSample
 *
 * When feed decimals are known from resolution, we can solve for token decimals.
 */
function deriveFromScaleFactor(
  scaleFactor: bigint,
  config: RawConfig,
  resolved: ResolvedDependencies,
): Record<string, unknown> {
  const derived: Record<string, unknown> = {};

  // Get feed decimals (zero-address feeds have 0 decimals per ChainlinkDataFeedLib)
  const bf1Dec = isZero(config.BASE_FEED_1)
    ? 0
    : (resolved.BASE_FEED_1?.decimals ?? null);
  const bf2Dec = isZero(config.BASE_FEED_2)
    ? 0
    : (resolved.BASE_FEED_2?.decimals ?? null);
  const qf1Dec = isZero(config.QUOTE_FEED_1)
    ? 0
    : (resolved.QUOTE_FEED_1?.decimals ?? null);
  const qf2Dec = isZero(config.QUOTE_FEED_2)
    ? 0
    : (resolved.QUOTE_FEED_2?.decimals ?? null);

  if (bf1Dec != null && bf2Dec != null && qf1Dec != null && qf2Dec != null) {
    const baseVaultSample = bigintOrThrow(
      config.BASE_VAULT_CONVERSION_SAMPLE,
      "BASE_VAULT_CONVERSION_SAMPLE",
    );
    const quoteVaultSample = bigintOrThrow(
      config.QUOTE_VAULT_CONVERSION_SAMPLE,
      "QUOTE_VAULT_CONVERSION_SAMPLE",
    );

    // scaleFactor = 10^exponent * quoteVaultSample / baseVaultSample
    // where exponent = 36 + dQuote + dQF1 + dQF2 - dBase - dBF1 - dBF2
    const adjusted = (scaleFactor * baseVaultSample) / quoteVaultSample;

    // Find the exponent: log10(adjusted)
    const expStr = adjusted.toString();
    // Check if it's a clean power of 10
    if (/^10*$/.test(expStr)) {
      const exponent = expStr.length - 1;
      // exponent = 36 + dQuote + qf1Dec + qf2Dec - dBase - bf1Dec - bf2Dec
      // => dQuote - dBase = exponent - 36 - qf1Dec - qf2Dec + bf1Dec + bf2Dec
      const decDiff = exponent - 36 - qf1Dec - qf2Dec + bf1Dec + bf2Dec;
      derived.quoteMinusBaseDecimals = decDiff;
      derived.scaleFactorExponent = exponent;
      derived.feedDecimals = { bf1Dec, bf2Dec, qf1Dec, qf2Dec };
    }
  }

  // Describe which slots are active vs disabled
  const activeSlots: string[] = [];
  const disabledSlots: string[] = [];
  for (const slot of [
    "BASE_VAULT", "BASE_FEED_1", "BASE_FEED_2",
    "QUOTE_VAULT", "QUOTE_FEED_1", "QUOTE_FEED_2",
  ]) {
    if (isZero(config[slot])) {
      disabledSlots.push(slot);
    } else {
      activeSlots.push(slot);
    }
  }
  derived.activeSlots = activeSlots;
  derived.disabledSlots = disabledSlots;

  return derived;
}

/**
 * Live values that must be read from the chain before calling the adapter.
 * The adapter itself is pure — these are fetched by the pipeline.
 */
export interface MorphoLiveValues {
  baseVaultAssets: bigint;
  baseFeed1Price: bigint;
  baseFeed2Price: bigint;
  quoteVaultAssets: bigint;
  quoteFeed1Price: bigint;
  quoteFeed2Price: bigint;
}

/**
 * Read the live values needed by the Morpho adapter.
 * This is the only network-touching function related to the adapter.
 */
export async function readMorphoLiveValues(
  client: import("viem").PublicClient,
  config: RawConfig,
): Promise<MorphoLiveValues> {
  const erc4626ConvertAbi = [
    {
      type: "function",
      name: "convertToAssets",
      inputs: [{ name: "shares", type: "uint256" }],
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
    },
  ] as const;

  const chainlinkPriceAbi = [
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
  ] as const;

  // For feeds that are not Chainlink aggregators but implement getPrice()
  const getPriceAbi = [
    {
      type: "function",
      name: "getPrice",
      inputs: [],
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
    },
  ] as const;

  async function readVaultAssets(
    vaultAddr: unknown,
    sample: unknown,
  ): Promise<bigint> {
    if (isZero(vaultAddr)) return 1n;
    const result = await client.readContract({
      address: vaultAddr as Address,
      abi: erc4626ConvertAbi,
      functionName: "convertToAssets",
      args: [BigInt(sample as string | number | bigint)],
    });
    return result as bigint;
  }

  async function readFeedPrice(feedAddr: unknown): Promise<bigint> {
    if (isZero(feedAddr)) return 1n;

    // Try latestRoundData first (standard Chainlink), then getPrice()
    try {
      const result = await client.readContract({
        address: feedAddr as Address,
        abi: chainlinkPriceAbi,
        functionName: "latestRoundData",
      });
      const answer = (result as readonly [bigint, bigint, bigint, bigint, bigint])[1];
      if (answer < 0n) throw new Error("Negative answer from feed");
      return answer;
    } catch {
      // Fallback to getPrice() for non-Chainlink feeds
      const result = await client.readContract({
        address: feedAddr as Address,
        abi: getPriceAbi,
        functionName: "getPrice",
      });
      return result as bigint;
    }
  }

  const [
    baseVaultAssets,
    baseFeed1Price,
    baseFeed2Price,
    quoteVaultAssets,
    quoteFeed1Price,
    quoteFeed2Price,
  ] = await Promise.all([
    readVaultAssets(config.BASE_VAULT, config.BASE_VAULT_CONVERSION_SAMPLE),
    readFeedPrice(config.BASE_FEED_1),
    readFeedPrice(config.BASE_FEED_2),
    readVaultAssets(config.QUOTE_VAULT, config.QUOTE_VAULT_CONVERSION_SAMPLE),
    readFeedPrice(config.QUOTE_FEED_1),
    readFeedPrice(config.QUOTE_FEED_2),
  ]);

  return {
    baseVaultAssets,
    baseFeed1Price,
    baseFeed2Price,
    quoteVaultAssets,
    quoteFeed1Price,
    quoteFeed2Price,
  };
}

const MORPHO_CAVEATS: string[] = [
  "Feed staleness is not checked. The oracle assumes each Chainlink feed upholds its own heartbeat and deviation thresholds.",
  "Min/max answer bounds on feeds are not validated. A feed returning an answer at its circuit-breaker floor will be accepted at face value.",
  "ERC4626 vault share prices can be manipulated via direct token transfers (donation attacks). The impact is bounded by TVL but is real for low-liquidity vaults.",
  "Markets should be configured so that price cannot instantly drop below oldPrice * LLTV * LIF. Vaults that can receive donations should not be used as the quote/loan asset.",
];
