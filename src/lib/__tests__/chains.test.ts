/**
 * The chain registry is configuration, but it has invariants that break
 * quietly: a typo'd viem import still compiles if the name exists, a duplicate
 * id silently shadows an earlier entry, and a trailing slash on an explorer
 * produces "https://arbiscan.io//address/0x…" on every link.
 */

import { describe, it, expect } from "vitest";
import { CHAIN_META, chainName, explorerFor, DEFAULT_CHAIN_ID } from "../chain-meta";
import { getClient, isSupportedChain, SUPPORTED_CHAINS } from "../chains";

describe("chain registry", () => {
  it("has no duplicate ids", () => {
    const ids = CHAIN_META.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps display metadata and viem definitions in lockstep", () => {
    // A chain offered in the picker but missing from VIEM_CHAINS would fail
    // only when someone selected it.
    for (const c of CHAIN_META) {
      expect(isSupportedChain(c.id), `${c.name} (${c.id})`).toBe(true);
    }
    expect(SUPPORTED_CHAINS.length).toBe(CHAIN_META.length);
  });

  it("builds a client for every chain it offers", () => {
    for (const c of CHAIN_META) {
      expect(() => getClient(c.id), `${c.name} (${c.id})`).not.toThrow();
    }
  });

  it("stores explorer origins without a trailing slash", () => {
    // Etherscan's chainlist returns them with one; links concatenate "/address".
    for (const c of CHAIN_META) {
      expect(c.explorer, c.name).toMatch(/^https:\/\//);
      expect(c.explorer.endsWith("/"), c.name).toBe(false);
    }
  });

  it("covers the chains that prompted this work", () => {
    const ids = new Set(CHAIN_META.map((c) => c.id));
    expect(ids.has(42161), "Arbitrum One").toBe(true);
    expect(ids.has(143), "Monad mainnet").toBe(true);
    expect(ids.has(9745), "Plasma mainnet").toBe(true);
  });

  it("rejects an unknown chain by name, not by crashing", () => {
    expect(isSupportedChain(999999)).toBe(false);
    expect(() => getClient(999999)).toThrow(/Unsupported chain/);
    expect(chainName(999999)).toBe("Chain 999999");
    expect(explorerFor(999999)).toMatch(/^https:\/\//);
  });

  it("defaults to a chain it actually supports", () => {
    expect(isSupportedChain(DEFAULT_CHAIN_ID)).toBe(true);
  });
});
