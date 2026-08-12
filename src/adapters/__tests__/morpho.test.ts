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
