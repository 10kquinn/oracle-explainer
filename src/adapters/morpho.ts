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
  FormulaExplanation,
} from "../lib/types";
import {
  buildHumanPrice,
  scaleDown,
  shortNumber,
  shortAddress,
  parseFeedPair,
  type HumanPrice,
} from "../lib/format";

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

  // Name the two sides of the ratio so the output can be read without
  // knowing which slot is which.
  const baseSymbol = inferBaseSymbol(config, resolved);
  const quoteSymbol = inferQuoteSymbol(config, resolved);
  derived.baseSymbol = baseSymbol;
  derived.quoteSymbol = quoteSymbol;

  // Rescale out of Morpho's 36-decimal convention.
  const humanPrice = buildMorphoHumanPrice(
    recomputedPrice,
    derived,
    baseSymbol,
    quoteSymbol,
  );
  if (humanPrice) derived.priceScaleExponent = humanPrice.exponent;

  const formulaExplanation = explainFormula({
    config,
    resolved,
    scaleFactor,
    baseVaultConversionSample,
    quoteVaultConversionSample,
    values: {
      baseVaultAssets,
      baseFeed1Price,
      baseFeed2Price,
      quoteVaultAssets,
      quoteFeed1Price,
      quoteFeed2Price,
    },
    baseSymbol,
    quoteSymbol,
    humanPrice,
    derived,
  });

  return {
    formula,
    formulaExplanation,
    recomputedPrice,
    humanPrice,
    components,
    caveats: MORPHO_CAVEATS,
    derived,
  };
}

/* ------------------------------------------------------------------ */
/*  Symbol inference                                                   */
/* ------------------------------------------------------------------ */

/** The collateral token — what one unit of the price is a unit of. */
function inferBaseSymbol(
  config: RawConfig,
  resolved: ResolvedDependencies,
): string | null {
  if (!isZero(config.BASE_VAULT)) {
    const v = resolved.BASE_VAULT;
    if (v?.symbol) return v.symbol;
  }
  if (!isZero(config.BASE_FEED_1)) {
    const pair = parseFeedPair(resolved.BASE_FEED_1?.description);
    if (pair.base) return pair.base;
  }
  return null;
}

/**
 * The loan token — the unit the price is denominated in.
 *
 * Order matters: an explicit quote vault or quote feed names the loan asset
 * directly. With the whole quote side disabled the loan asset is whatever unit
 * the base side terminates in, which is the last active base feed's right leg,
 * or failing that the base vault's own underlying asset.
 */
function inferQuoteSymbol(
  config: RawConfig,
  resolved: ResolvedDependencies,
): string | null {
  if (!isZero(config.QUOTE_VAULT)) {
    const v = resolved.QUOTE_VAULT;
    if (v?.symbol) return v.symbol;
  }
  if (!isZero(config.QUOTE_FEED_1)) {
    const pair = parseFeedPair(resolved.QUOTE_FEED_1?.description);
    if (pair.base) return pair.base;
  }
  if (!isZero(config.BASE_FEED_2)) {
    const pair = parseFeedPair(resolved.BASE_FEED_2?.description);
    if (pair.quote) return pair.quote;
  }
  if (!isZero(config.BASE_FEED_1)) {
    const pair = parseFeedPair(resolved.BASE_FEED_1?.description);
    if (pair.quote) return pair.quote;
  }
  if (!isZero(config.BASE_VAULT)) {
    const v = resolved.BASE_VAULT;
    if (v?.assetSymbol) return v.assetSymbol;
  }
  return null;
}

/**
 * Morpho's price convention is 10^(36 + loanDecimals - collateralDecimals).
 * `quoteMinusBaseDecimals` is that decimal difference, recovered by inverting
 * SCALE_FACTOR. Without it we cannot state a human price honestly, so we
 * return null rather than guess an exponent.
 */
function buildMorphoHumanPrice(
  recomputedPrice: bigint,
  derived: Record<string, unknown>,
  baseSymbol: string | null,
  quoteSymbol: string | null,
): HumanPrice | null {
  const decDiff = derived.quoteMinusBaseDecimals;
  if (typeof decDiff !== "number") return null;

  return buildHumanPrice({
    raw: recomputedPrice,
    exponent: 36 + decDiff,
    baseSymbol,
    quoteSymbol,
    basis:
      `Morpho scales price by 10^(36 + loanDecimals - collateralDecimals). ` +
      `Inverting SCALE_FACTOR gives loanDecimals - collateralDecimals = ${decDiff}, ` +
      `so the raw value was divided by 10^${36 + decDiff}.`,
  });
}

/* ------------------------------------------------------------------ */
/*  Plain-English formula walkthrough                                  */
/* ------------------------------------------------------------------ */

/** Render a feed answer at its own decimals, e.g. 99987654 @ 8 -> "0.99987654". */
function feedValueInWords(value: bigint, decimals: number | null): string {
  if (decimals == null) return value.toString();
  return scaleDown(value, decimals);
}

/**
 * Name a dependency for prose. A slot name like BASE_FEED_1 is a variable, not
 * a name — if the contract publishes no description() or symbol(), say so and
 * give the address, which is at least something the reader can go look up.
 */
function describeTarget(
  addr: unknown,
  resolved: ResolvedDependencies[string] | undefined,
): { name: string; anonymous: boolean } {
  if (resolved?.label) return { name: resolved.label, anonymous: false };
  if (typeof addr === "string" && addr.startsWith("0x")) {
    return { name: `the contract at ${shortAddress(addr)}`, anonymous: true };
  }
  return { name: "an unnamed contract", anonymous: true };
}

function explainFormula(ctx: {
  config: RawConfig;
  resolved: ResolvedDependencies;
  scaleFactor: bigint;
  baseVaultConversionSample: bigint;
  quoteVaultConversionSample: bigint;
  values: {
    baseVaultAssets: bigint;
    baseFeed1Price: bigint;
    baseFeed2Price: bigint;
    quoteVaultAssets: bigint;
    quoteFeed1Price: bigint;
    quoteFeed2Price: bigint;
  };
  baseSymbol: string | null;
  quoteSymbol: string | null;
  humanPrice: HumanPrice | null;
  derived: Record<string, unknown>;
}): FormulaExplanation {
  const { config, resolved, values, baseSymbol, quoteSymbol, humanPrice } = ctx;

  const quote = quoteSymbol ?? "the loan token";
  // "1 the collateral token" — keep the article out of the count.
  const oneBase = baseSymbol ? `1 ${baseSymbol}` : "one unit of the collateral token";
  const inQuote = quoteSymbol ? quoteSymbol : "the loan token";

  const summary =
    `This oracle answers one question: what is ${oneBase} worth, measured in ${inQuote}? ` +
    `Every term below either contributes to that answer or is switched off.` +
    (baseSymbol && quoteSymbol
      ? ""
      : ` Neither side could be named from the oracle alone — the contracts it reads publish no ` +
        `symbol or description — so the tokens are identified by role rather than by ticker.`);

  const steps: string[] = [];

  // --- numerator: value of the collateral ---
  if (!isZero(config.BASE_VAULT)) {
    const v = resolved.BASE_VAULT;
    const label = describeTarget(config.BASE_VAULT, v).name;
    const underlying = v?.assetSymbol ?? "its underlying asset";
    const sample = ctx.baseVaultConversionSample;
    steps.push(
      `Start with the vault's own exchange rate. The oracle calls ` +
        `${label}.convertToAssets(${shortNumber(sample)}) — how much ${underlying} would that ` +
        `many share units redeem for? — and gets ${values.baseVaultAssets.toString()}. That ratio ` +
        `is the vault's own internal accounting, total assets divided by total shares. It is not ` +
        `a traded market price and nobody has to quote it for the oracle to work.`,
    );
  }

  for (const [slot, price] of [
    ["BASE_FEED_1", values.baseFeed1Price],
    ["BASE_FEED_2", values.baseFeed2Price],
  ] as const) {
    if (isZero(config[slot])) continue;
    const r = resolved[slot];
    const pair = parseFeedPair(r?.description);
    const { name, anonymous } = describeTarget(config[slot], r);
    const shown = feedValueInWords(price, r?.decimals ?? null);
    const raw =
      r?.decimals != null
        ? ` (raw ${price.toString()}, ${r.decimals} decimals)`
        : "";
    const nameless = anonymous
      ? ` This feed publishes no description(), so there is no on-chain label for what it prices — ` +
        `the pair has to be established from the market it is used in.`
      : "";
    // The first step has no running value to multiply into yet.
    if (steps.length === 0) {
      steps.push(
        `Start with ${name}, a price feed currently reporting ${shown}${raw}. ` +
          (pair.base && pair.quote
            ? `That is the price of one ${pair.base} in ${pair.quote}, and it is where the ` +
              `collateral's value enters the calculation.`
            : `That is where the collateral's value enters the calculation.`) +
          nameless,
      );
    } else {
      steps.push(
        `Multiply by ${name}, currently reporting ${shown}${raw}. ` +
          (pair.base && pair.quote
            ? `This converts the running value from ${pair.base} into ${pair.quote}.`
            : `This converts the running value into that feed's quote unit.`) +
          nameless,
      );
    }
  }

  // --- denominator: value of the loan asset ---
  if (!isZero(config.QUOTE_VAULT)) {
    const v = resolved.QUOTE_VAULT;
    const label = describeTarget(config.QUOTE_VAULT, v).name;
    const sample = ctx.quoteVaultConversionSample;
    steps.push(
      `Divide by ${label}'s exchange rate — convertToAssets(${shortNumber(sample)}) = ` +
        `${values.quoteVaultAssets.toString()} — because the loan asset is itself a vault share, ` +
        `so its own redemption value has to be divided back out.`,
    );
  }

  for (const [slot, price] of [
    ["QUOTE_FEED_1", values.quoteFeed1Price],
    ["QUOTE_FEED_2", values.quoteFeed2Price],
  ] as const) {
    if (isZero(config[slot])) continue;
    const r = resolved[slot];
    const pair = parseFeedPair(r?.description);
    const { name } = describeTarget(config[slot], r);
    const shown = feedValueInWords(price, r?.decimals ?? null);
    steps.push(
      `Divide by ${name}, currently reporting ${shown}` +
        (r?.decimals != null ? ` (raw ${price.toString()}, ${r.decimals} decimals)` : "") +
        `. ` +
        (pair.base
          ? `This prices the loan asset ${pair.base} in the same common unit, so it cancels out and ` +
            `the result ends up denominated in ${pair.base} rather than in that common unit.`
          : `This prices the loan asset in the same common unit so that it cancels out.`),
    );
  }

  // --- scale factor ---
  const exponent = humanPrice?.exponent ?? null;
  steps.push(
    `Multiply by SCALE_FACTOR (${shortNumber(ctx.scaleFactor)}), a constant fixed once in the ` +
      `constructor and never changeable afterwards. It carries no price information — it only ` +
      `shifts the decimal point so the result lands in Morpho's fixed-point format` +
      (exponent != null ? `, which here means the answer is scaled by 10^${exponent}.` : `.`),
  );

  // --- notes ---
  const notes: string[] = [];

  const disabled = (ctx.derived.disabledSlots as string[] | undefined) ?? [];
  if (disabled.length > 0) {
    notes.push(
      `${disabled.length} of the 6 configurable slots are set to the zero address ` +
        `(${disabled.join(", ")}). Morpho's helper libraries return 1 — not 0 — for the zero ` +
        `address, so a disabled slot multiplies or divides by one and drops out of the equation ` +
        `entirely. It does not zero the price.`,
    );
  }

  const allFeedsOff =
    isZero(config.BASE_FEED_1) &&
    isZero(config.BASE_FEED_2) &&
    isZero(config.QUOTE_FEED_1) &&
    isZero(config.QUOTE_FEED_2);
  if (allFeedsOff) {
    notes.push(
      `No external price feed is read at any point. The entire price is the vault's own ` +
        `share-to-asset ratio, with ${quote} hardcoded at exactly parity. Whatever ${quote} is ` +
        `actually trading at in the wider market never enters this contract.`,
    );
  } else if (isZero(config.QUOTE_FEED_1) && isZero(config.QUOTE_FEED_2)) {
    notes.push(
      `Both quote feed slots are disabled, so ${quote} is assumed to be worth exactly one unit ` +
        `of the base side's terminal unit. No market price for the loan asset enters the contract.`,
    );
  }

  if (humanPrice) {
    notes.push(
      `Rescaled out of that fixed-point format, the current answer reads: ${humanPrice.statement}.`,
    );
  }

  return { summary, steps, notes };
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
