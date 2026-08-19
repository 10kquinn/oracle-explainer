/**
 * Chainlink adapter fixtures.
 *
 * The family's two shapes are indistinguishable by ABI, so both are pinned:
 * a proxy that forwards to a swappable aggregator, and a bare aggregator read
 * directly. The verification story differs between them and the explanation
 * has to say which one it got.
 */

import { describe, it, expect } from "vitest";
import { zeroAddress } from "viem";
import { chainlinkAdapter, type ChainlinkLiveValues } from "../chainlink";
import type { RawConfig, ResolvedDependencies } from "../../lib/types";

const AGGREGATOR = "0xE62B71cf983019BFf55bC83B48601ce8419650CC";
const OWNER = "0x21f73D42Eb58Ba49dEB03BC482490dCC6BB55C86";

const NOW = 1_770_000_000n;

const PROXY_CONFIG: RawConfig = {
  decimals: 8,
  description: "ETH / USD",
  aggregator: AGGREGATOR,
  version: 4n,
};

const PROXY_RESOLVED: ResolvedDependencies = {
  aggregator: {
    address: AGGREGATOR,
    label: "ETH / USD",
    symbol: null,
    name: null,
    decimals: 8,
    description: "ETH / USD",
    owner: OWNER,
    aggregator: null,
    aggregatorOwner: OWNER,
    asset: null,
    assetSymbol: null,
  },
};

const PROXY_LIVE: ChainlinkLiveValues = {
  answer: 300000000000n, // 3000.00000000
  roundId: 18446744073709551616n + 42n,
  updatedAt: NOW - 600n,
  aggregatorAnswer: 300000000000n,
  replayedAnswer: null,
  blockTimestamp: NOW,
};

describe("Chainlink adapter — proxy fixture", () => {
  it("recomputes the answer by following the aggregator pointer", () => {
    const r = chainlinkAdapter(PROXY_CONFIG, PROXY_RESOLVED, PROXY_LIVE);
    // The gate compares this against latestRoundData().answer.
    expect(r.recomputedPrice).toBe(300000000000n);
  });

  it("rescales the answer by the feed's own decimals", () => {
    const r = chainlinkAdapter(PROXY_CONFIG, PROXY_RESOLVED, PROXY_LIVE);
    expect(r.humanPrice!.value).toBe("3000");
    expect(r.humanPrice!.baseSymbol).toBe("ETH");
    expect(r.humanPrice!.quoteSymbol).toBe("USD");
    expect(r.humanPrice!.usdLike).toBe(true);
  });

  it("says it is a push feed, not a computation", () => {
    const r = chainlinkAdapter(PROXY_CONFIG, PROXY_RESOLVED, PROXY_LIVE);
    expect(r.formulaExplanation.summary).toContain("push feed");
    expect(r.formulaExplanation.summary).toContain("Nothing is computed on demand");
  });

  it("explains the proxy indirection and reports the answer's age", () => {
    const r = chainlinkAdapter(PROXY_CONFIG, PROXY_RESOLVED, PROXY_LIVE);
    const steps = r.formulaExplanation.steps.join(" ");
    expect(steps).toContain("is a proxy");
    expect(steps).toContain("can be replaced");
    expect(steps).toContain("10 minutes ago");
    expect(r.derived.lastUpdatedSecondsAgo).toBe(600);
  });

  it("refuses to treat the interface as a provenance claim", () => {
    const r = chainlinkAdapter(PROXY_CONFIG, PROXY_RESOLVED, PROXY_LIVE);
    const notes = r.formulaExplanation.notes.join(" ");
    expect(notes).toContain("shape, not a provenance claim");
    // It reports who controls it as a fact, without concluding anything.
    expect(notes).toContain("0x21f7…5C86");
    expect(notes).not.toMatch(/is (a )?(genuine|official|real) Chainlink/i);
  });

  it("flags that a swappable aggregator is a standing power", () => {
    const r = chainlinkAdapter(PROXY_CONFIG, PROXY_RESOLVED, PROXY_LIVE);
    expect(r.formulaExplanation.notes.join(" ")).toContain("redirect it");
  });
});

/* ------------------------------------------------------------------ */

const BARE_CONFIG: RawConfig = {
  decimals: 18,
  description: "wstETH / ETH Exchange Rate",
  aggregator: zeroAddress,
};

const BARE_LIVE: ChainlinkLiveValues = {
  answer: 1207000000000000000n, // 1.207
  roundId: 7n,
  updatedAt: NOW - 90000n,
  aggregatorAnswer: null,
  replayedAnswer: 1207000000000000000n,
  blockTimestamp: NOW,
};

describe("Chainlink adapter — bare aggregator fixture", () => {
  it("verifies by replaying its own latest round id", () => {
    const r = chainlinkAdapter(BARE_CONFIG, {}, BARE_LIVE);
    expect(r.recomputedPrice).toBe(1207000000000000000n);
    expect(r.derived.verificationStrength).toContain("replay");
  });

  it("states there is no proxy indirection", () => {
    const r = chainlinkAdapter(BARE_CONFIG, {}, BARE_LIVE);
    expect(r.formulaExplanation.steps[0]).toContain("not a proxy");
    // The swappable-aggregator warning only applies to proxies.
    expect(r.formulaExplanation.notes.join(" ")).not.toContain("redirect it");
  });

  it("does not invent a pair from a non-pair description", () => {
    const r = chainlinkAdapter(BARE_CONFIG, {}, BARE_LIVE);
    expect(r.humanPrice!.value).toBe("1.207");
    // "wstETH / ETH Exchange Rate" splits into two, but the right leg is not a
    // ticker, so neither leg is taken.
    expect(r.humanPrice!.baseSymbol).toBeNull();
    expect(r.humanPrice!.quoteSymbol).toBeNull();
  });

  it("reports a day-old answer in hours, which is the more useful unit", () => {
    const r = chainlinkAdapter(BARE_CONFIG, {}, BARE_LIVE);
    expect(r.derived.lastUpdatedAgo).toBe("25 hours");
  });
});
