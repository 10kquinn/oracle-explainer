/**
 * Deterministic human-readable formatting of Morpho-convention oracle prices.
 *
 * Morpho's IOracle returns the value of 1 collateral (base) token expressed in
 * loan (quote) token units, scaled by 10^(36 + loanDecimals - collateralDecimals).
 * Dividing the raw uint256 back out by that exponent recovers the ratio a human
 * reads: "1 sUSDe = 1.24401743 USDe".
 *
 * This is arithmetic, not narration.
 */

/** Symbols whose unit is close enough to a dollar that a "$" prefix is honest. */
const USD_LIKE = new Set([
  "USD", "USDC", "USDT", "DAI", "USDE", "PYUSD", "USDS", "GHO", "FRAX",
  "LUSD", "USD0", "CRVUSD", "SUSD", "USDA", "USDL", "RLUSD", "FDUSD", "USR",
]);

export function isUsdLike(symbol: string | null): boolean {
  if (!symbol) return false;
  return USD_LIKE.has(symbol.toUpperCase());
}

/**
 * Render large round constants in power-of-ten shorthand so a reader sees
 * "1e28" rather than counting zeros. Anything that is not a clean power of ten
 * is printed in full — never approximated.
 */
export function shortNumber(v: bigint): string {
  const s = v.toString();
  if (/^10{5,}$/.test(s)) return `1e${s.length - 1}`;
  return s;
}

/** 0x1234…abcd — enough to identify a contract in prose without a wall of hex. */
export function shortAddress(addr: string): string {
  if (!addr.startsWith("0x") || addr.length !== 42) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Split a feed description into the asset it prices and the unit it prices in.
 *
 * Only "TICKER / TICKER" counts. Descriptions like "wstETH / ETH Exchange Rate"
 * or "PST-USDC Exchange Rate (Calculated)" split into something that looks like
 * a pair but is not one, and treating the right-hand side as a unit produces
 * output like "1 wstETH = 1.207 ETH Exchange Rate". A leg has to look like a
 * ticker — short, no whitespace — or we take neither.
 */
export function parseFeedPair(desc: string | null | undefined): {
  base: string | null;
  quote: string | null;
} {
  const none = { base: null, quote: null };
  if (!desc) return none;

  const parts = desc.split("/").map((x) => x.trim());
  if (parts.length !== 2) return none;

  const isTicker = (x: string) =>
    x.length > 0 && x.length <= 12 && !/\s/.test(x);

  if (!isTicker(parts[0]) || !isTicker(parts[1])) return none;
  return { base: parts[0], quote: parts[1] };
}

export interface HumanPrice {
  /** Decimal string, e.g. "1.24401743" */
  value: string;
  /** The raw price was divided by 10^exponent to get `value`. */
  exponent: number;
  /** Collateral token symbol, if resolvable. */
  baseSymbol: string | null;
  /** Loan token symbol, if resolvable. */
  quoteSymbol: string | null;
  /** Whether the loan asset is a USD-denominated unit (allows a "$" prefix). */
  usdLike: boolean;
  /** Ready-to-render sentence, e.g. "1 sUSDe = 1.24401743 USDe". */
  statement: string;
  /** How the exponent was established, for auditability. */
  basis: string;
}

/**
 * Convert a raw Morpho price into a decimal string.
 * Pure integer math — no float rounding of the raw value.
 */
export function scaleDown(raw: bigint, exponent: number): string {
  if (exponent < 0) {
    return (raw * 10n ** BigInt(-exponent)).toString();
  }
  const divisor = 10n ** BigInt(exponent);
  const whole = raw / divisor;
  const remainder = raw % divisor;

  if (remainder === 0n) return whole.toString();

  let frac = remainder.toString().padStart(exponent, "0");
  frac = frac.replace(/0+$/, "");

  // Keep the output readable: at most 8 significant fractional digits,
  // counting from the first non-zero digit so sub-1 prices stay legible.
  const leadingZeros = frac.length - frac.replace(/^0+/, "").length;
  const maxLen = Math.min(frac.length, leadingZeros + 8);
  frac = frac.slice(0, maxLen).replace(/0+$/, "");

  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

export function buildHumanPrice(opts: {
  raw: bigint;
  exponent: number;
  baseSymbol: string | null;
  quoteSymbol: string | null;
  basis: string;
}): HumanPrice {
  const { raw, exponent, baseSymbol, quoteSymbol, basis } = opts;
  const value = scaleDown(raw, exponent);
  const usdLike = isUsdLike(quoteSymbol);

  const lhs = baseSymbol ? `1 ${baseSymbol}` : "1 collateral token";

  let statement: string;
  if (quoteSymbol) {
    statement = `${lhs} = ${value} ${quoteSymbol}`;
    if (usdLike) statement += ` (≈ $${value})`;
  } else {
    // "1 loan tokens" reads like a bug. Name the unit in the singular and say
    // plainly that we could not identify it.
    statement = `${lhs} = ${value} units of the loan token (unidentified)`;
  }

  return { value, exponent, baseSymbol, quoteSymbol, usdLike, statement, basis };
}
