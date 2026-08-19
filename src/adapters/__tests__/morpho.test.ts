/**
 * Golden fixture test for the Morpho adapter.
 *
 * Oracle: 0x67BcC03438D7d71c39343d7AD21cb73Dc19aDB89 (Ethereum mainnet)
 * MorphoChainlinkOracleV2 — sUSDe/USDe-like pricing
 *
 * All feeds are zero (disabled), quote vault is zero, only BASE_VAULT is active.
 * Price is purely sUSDe's ERC4626 share-to-asset ratio.
 *
 * This test is pure — it uses hardcoded config values and does not touch the network.
 */

import { describe, it, expect } from "vitest";
import { morphoAdapter, type MorphoLiveValues } from "../morpho";
import { zeroAddress } from "viem";
import type { RawConfig, ResolvedDependencies } from "../../lib/types";

// Pinned config from the spec (read from chain at a specific block)
const GOLDEN_CONFIG: RawConfig = {
  BASE_VAULT: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
  BASE_VAULT_CONVERSION_SAMPLE: 100000000n, // 1e8
  BASE_FEED_1: zeroAddress,
  BASE_FEED_2: zeroAddress,
  QUOTE_FEED_1: zeroAddress,
  QUOTE_FEED_2: zeroAddress,
  QUOTE_VAULT: zeroAddress,
  QUOTE_VAULT_CONVERSION_SAMPLE: 1n,
  SCALE_FACTOR: 10000000000000000000000000000n, // 1e28
};

// Resolved dependencies (simplified for test)
const GOLDEN_RESOLVED: ResolvedDependencies = {
  BASE_VAULT: {
    address: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
    label: "Ethena sUSDe",
    symbol: "sUSDe",
    name: "Staked USDe",
    decimals: 18,
    description: null,
    owner: null,
    aggregator: null,
    aggregatorOwner: null,
    asset: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    assetSymbol: "USDe",
  },
  BASE_FEED_1: {
    address: zeroAddress,
    label: "(zero — identity/disabled)",
    symbol: null,
    name: null,
    decimals: null,
    description: null,
    owner: null,
    aggregator: null,
    aggregatorOwner: null,
    asset: null,
    assetSymbol: null,
  },
  BASE_FEED_2: {
    address: zeroAddress,
    label: "(zero — identity/disabled)",
    symbol: null,
    name: null,
    decimals: null,
    description: null,
    owner: null,
    aggregator: null,
    aggregatorOwner: null,
    asset: null,
    assetSymbol: null,
  },
  QUOTE_FEED_1: {
    address: zeroAddress,
    label: "(zero — identity/disabled)",
    symbol: null,
    name: null,
    decimals: null,
    description: null,
    owner: null,
    aggregator: null,
    aggregatorOwner: null,
    asset: null,
    assetSymbol: null,
  },
  QUOTE_FEED_2: {
    address: zeroAddress,
    label: "(zero — identity/disabled)",
    symbol: null,
    name: null,
    decimals: null,
    description: null,
    owner: null,
    aggregator: null,
    aggregatorOwner: null,
    asset: null,
    assetSymbol: null,
  },
  QUOTE_VAULT: {
    address: zeroAddress,
    label: "(zero — identity/disabled)",
    symbol: null,
    name: null,
    decimals: null,
    description: null,
    owner: null,
    aggregator: null,
    aggregatorOwner: null,
    asset: null,
    assetSymbol: null,
  },
};

// The sUSDe convertToAssets(1e8) value at the pinned block
const GOLDEN_LIVE_VALUES: MorphoLiveValues = {
  baseVaultAssets: 124300412n, // sUSDe.convertToAssets(1e8)
  baseFeed1Price: 1n, // zero address -> identity
  baseFeed2Price: 1n,
  quoteVaultAssets: 1n,
  quoteFeed1Price: 1n,
  quoteFeed2Price: 1n,
};

// Expected price: 1e28 * 124300412 = 1243004120000000000000000000000000000
const EXPECTED_PRICE = 1243004120000000000000000000000000000n;

describe("Morpho adapter — golden fixture", () => {
  it("reproduces the exact on-chain price", () => {
    const result = morphoAdapter(
      GOLDEN_CONFIG,
      GOLDEN_RESOLVED,
      GOLDEN_LIVE_VALUES,
    );

    expect(result.recomputedPrice).toBe(EXPECTED_PRICE);
  });

  it("identifies all feed/vault slots as disabled except BASE_VAULT", () => {
    const result = morphoAdapter(
      GOLDEN_CONFIG,
      GOLDEN_RESOLVED,
      GOLDEN_LIVE_VALUES,
    );

    const derived = result.derived as {
      activeSlots: string[];
      disabledSlots: string[];
    };

    expect(derived.activeSlots).toEqual(["BASE_VAULT"]);
    expect(derived.disabledSlots).toContain("BASE_FEED_1");
    expect(derived.disabledSlots).toContain("BASE_FEED_2");
    expect(derived.disabledSlots).toContain("QUOTE_VAULT");
    expect(derived.disabledSlots).toContain("QUOTE_FEED_1");
    expect(derived.disabledSlots).toContain("QUOTE_FEED_2");
  });

  it("derives that quote and base token have equal decimals", () => {
    const result = morphoAdapter(
      GOLDEN_CONFIG,
      GOLDEN_RESOLVED,
      GOLDEN_LIVE_VALUES,
    );

    // SCALE_FACTOR = 1e28
    // 10^(36 + dQuote - dBase) / 1e8 = 1e28
    // => dQuote - dBase = 0
    expect(result.derived.quoteMinusBaseDecimals).toBe(0);
  });

  it("rescales the raw price into a human-readable ratio", () => {
    const result = morphoAdapter(
      GOLDEN_CONFIG,
      GOLDEN_RESOLVED,
      GOLDEN_LIVE_VALUES,
    );

    // 1.24300412e36 with a 10^36 scale -> 1.24300412
    expect(result.humanPrice).not.toBeNull();
    expect(result.humanPrice!.value).toBe("1.24300412");
    expect(result.humanPrice!.exponent).toBe(36);
    expect(result.humanPrice!.baseSymbol).toBe("sUSDe");
    // Quote side is fully disabled, so the loan asset is the base vault's
    // own underlying — USDe, reached via asset().
    expect(result.humanPrice!.quoteSymbol).toBe("USDe");
    expect(result.humanPrice!.usdLike).toBe(true);
    expect(result.humanPrice!.statement).toBe(
      "1 sUSDe = 1.24300412 USDe (≈ $1.24300412)",
    );
  });

  it("explains the formula in plain English without inventing sources", () => {
    const result = morphoAdapter(
      GOLDEN_CONFIG,
      GOLDEN_RESOLVED,
      GOLDEN_LIVE_VALUES,
    );

    const { summary, steps, notes } = result.formulaExplanation;

    expect(summary).toContain("1 sUSDe");
    expect(summary).toContain("USDe");

    // One step for the vault, one for SCALE_FACTOR. No feed steps —
    // every feed slot is disabled.
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain("convertToAssets(1e8)");
    expect(steps[0]).toContain("124300412");
    expect(steps[1]).toContain("SCALE_FACTOR");

    const noteText = notes.join(" ");
    expect(noteText).toContain("No external price feed is read");
    // The zero-address sentinel must be stated as identity, not as zero.
    expect(noteText).toContain("return 1 — not 0 —");
    expect(noteText).toContain("1 sUSDe = 1.24300412 USDe");
  });

  it("emits the correct caveats", () => {
    const result = morphoAdapter(
      GOLDEN_CONFIG,
      GOLDEN_RESOLVED,
      GOLDEN_LIVE_VALUES,
    );

    expect(result.caveats.length).toBeGreaterThan(0);
    expect(result.caveats[0]).toContain("staleness");
  });

  it("builds a formula mentioning only active components", () => {
    const result = morphoAdapter(
      GOLDEN_CONFIG,
      GOLDEN_RESOLVED,
      GOLDEN_LIVE_VALUES,
    );

    // Formula should include SCALE_FACTOR and sUSDe vault, nothing else
    expect(result.formula).toContain("SCALE_FACTOR");
    expect(result.formula).toContain("Ethena sUSDe");
    // Should not mention disabled feeds
    expect(result.formula).not.toContain("BASE_FEED_1");
    expect(result.formula).not.toContain("QUOTE_FEED_1");
  });
});

/* ------------------------------------------------------------------ */
/*  Feed-driven fixture                                                */
/* ------------------------------------------------------------------ */

/**
 * The golden fixture has every feed slot disabled, so it never exercises the
 * feed arms of the formula. This second fixture is the common shape instead:
 * wstETH collateral priced in USDC through a two-hop base chain and a one-hop
 * quote chain, no vaults involved.
 *
 * SCALE_FACTOR = 10^(36 + 6 + 8 + 0 - 18 - 18 - 8) = 10^6
 * price = 1e6 * 1.2e18 * 3.0e11 / 1.0e8 = 3.6e27
 * rescaled by 10^(36 + 6 - 18) = 10^24  ->  3600 USDC per wstETH
 */
function zeroResolved(): ResolvedDependencies[string] {
  return {
    address: zeroAddress,
    label: "(zero — identity/disabled)",
    symbol: null,
    name: null,
    decimals: null,
    description: null,
    owner: null,
    aggregator: null,
    aggregatorOwner: null,
    asset: null,
    assetSymbol: null,
  };
}

const FEED_CONFIG: RawConfig = {
  BASE_VAULT: zeroAddress,
  BASE_VAULT_CONVERSION_SAMPLE: 1n,
  BASE_FEED_1: "0x1111111111111111111111111111111111111111",
  BASE_FEED_2: "0x2222222222222222222222222222222222222222",
  QUOTE_FEED_1: "0x3333333333333333333333333333333333333333",
  QUOTE_FEED_2: zeroAddress,
  QUOTE_VAULT: zeroAddress,
  QUOTE_VAULT_CONVERSION_SAMPLE: 1n,
  SCALE_FACTOR: 1000000n, // 1e6
};

const FEED_RESOLVED: ResolvedDependencies = {
  BASE_VAULT: zeroResolved(),
  QUOTE_VAULT: zeroResolved(),
  QUOTE_FEED_2: zeroResolved(),
  BASE_FEED_1: {
    ...zeroResolved(),
    address: "0x1111111111111111111111111111111111111111",
    label: "wstETH / ETH",
    description: "wstETH / ETH",
    decimals: 18,
  },
  BASE_FEED_2: {
    ...zeroResolved(),
    address: "0x2222222222222222222222222222222222222222",
    label: "ETH / USD",
    description: "ETH / USD",
    decimals: 8,
  },
  QUOTE_FEED_1: {
    ...zeroResolved(),
    address: "0x3333333333333333333333333333333333333333",
    label: "USDC / USD",
    description: "USDC / USD",
    decimals: 8,
  },
};

const FEED_LIVE_VALUES: MorphoLiveValues = {
  baseVaultAssets: 1n,
  baseFeed1Price: 1200000000000000000n, // 1.2 ETH per wstETH, 18 dec
  baseFeed2Price: 300000000000n, // 3000 USD per ETH, 8 dec
  quoteVaultAssets: 1n,
  quoteFeed1Price: 100000000n, // 1.00 USD per USDC, 8 dec
  quoteFeed2Price: 1n,
};

describe("Morpho adapter — feed-driven fixture", () => {
  it("computes the price through both feed legs", () => {
    const result = morphoAdapter(FEED_CONFIG, FEED_RESOLVED, FEED_LIVE_VALUES);
    expect(result.recomputedPrice).toBe(3600000000000000000000000000n); // 3.6e27
  });

  it("names both sides of the ratio from the feed descriptions", () => {
    const result = morphoAdapter(FEED_CONFIG, FEED_RESOLVED, FEED_LIVE_VALUES);

    expect(result.derived.quoteMinusBaseDecimals).toBe(-12);
    expect(result.humanPrice).not.toBeNull();
    expect(result.humanPrice!.exponent).toBe(24);
    expect(result.humanPrice!.statement).toBe(
      "1 wstETH = 3600 USDC (≈ $3600)",
    );
  });

  it("walks each active feed in order and states its conversion", () => {
    const result = morphoAdapter(FEED_CONFIG, FEED_RESOLVED, FEED_LIVE_VALUES);
    const { steps, notes } = result.formulaExplanation;

    // wstETH/ETH, ETH/USD, USDC/USD, SCALE_FACTOR — no vault steps.
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain("wstETH / ETH");
    expect(steps[0]).toContain("1.2");
    expect(steps[0]).toContain("Start with wstETH / ETH");
    expect(steps[0]).toContain("price of one wstETH in ETH");
    expect(steps[1]).toContain("ETH / USD");
    expect(steps[1]).toContain("3000");
    expect(steps[2]).toContain("Divide by USDC / USD");
    expect(steps[3]).toContain("SCALE_FACTOR");

    // The loan asset has a live feed here, so the parity note must not appear.
    expect(notes.join(" ")).not.toContain("No external price feed is read");
  });
});

/* ------------------------------------------------------------------ */
/*  Anonymous-feed fixture                                             */
/* ------------------------------------------------------------------ */

/**
 * Taken from a real mainnet oracle (0xee70EC00…) whose base feed implements
 * decimals() but neither description() nor symbol(). Nothing can be named, and
 * the explanation has to say so rather than leak slot names into prose or
 * guess a ticker.
 */
const ANON_CONFIG: RawConfig = {
  BASE_VAULT: zeroAddress,
  BASE_VAULT_CONVERSION_SAMPLE: 1n,
  BASE_FEED_1: "0x7205924400000000000000000000000000000000",
  BASE_FEED_2: zeroAddress,
  QUOTE_FEED_1: zeroAddress,
  QUOTE_FEED_2: zeroAddress,
  QUOTE_VAULT: zeroAddress,
  QUOTE_VAULT_CONVERSION_SAMPLE: 1n,
  SCALE_FACTOR: 10000000000000000000000000000n, // 1e28
};

const ANON_RESOLVED: ResolvedDependencies = {
  BASE_VAULT: zeroResolved(),
  BASE_FEED_2: zeroResolved(),
  QUOTE_VAULT: zeroResolved(),
  QUOTE_FEED_1: zeroResolved(),
  QUOTE_FEED_2: zeroResolved(),
  BASE_FEED_1: {
    ...zeroResolved(),
    address: "0x7205924400000000000000000000000000000000",
    label: null,
    decimals: 8,
  },
};

const ANON_LIVE: MorphoLiveValues = {
  baseVaultAssets: 1n,
  baseFeed1Price: 100000000n,
  baseFeed2Price: 1n,
  quoteVaultAssets: 1n,
  quoteFeed1Price: 1n,
  quoteFeed2Price: 1n,
};

describe("Morpho adapter — unnameable dependencies", () => {
  it("identifies an anonymous feed by address, never by slot name", () => {
    const result = morphoAdapter(ANON_CONFIG, ANON_RESOLVED, ANON_LIVE);
    const { summary, steps } = result.formulaExplanation;

    expect(steps[0]).toContain("0x7205…0000");
    expect(steps[0]).toContain("publishes no description()");
    // The slot name is an internal variable and must not reach the prose.
    expect(steps[0]).not.toContain("BASE_FEED_1");
    expect(summary).not.toContain("BASE_FEED_1");
  });

  it("counts in the singular and admits the tokens are unidentified", () => {
    const result = morphoAdapter(ANON_CONFIG, ANON_RESOLVED, ANON_LIVE);

    expect(result.formulaExplanation.summary).toContain(
      "one unit of the collateral token",
    );
    expect(result.formulaExplanation.summary).toContain("could be named");
    // "1 loan tokens" was the old output — plural noun after the numeral 1.
    expect(result.humanPrice!.statement).not.toMatch(/= \S+ loan tokens$/);
    expect(result.humanPrice!.statement).toContain("(unidentified)");
  });
});
