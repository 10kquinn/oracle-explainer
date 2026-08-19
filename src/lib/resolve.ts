/**
 * Dependency resolution: enrich raw addresses with human-readable metadata.
 * 1 hop: symbol, name, decimals, description, owner
 * 2 hops: aggregator -> owner (for Chainlink feeds)
 */

import { type Address, type PublicClient, zeroAddress, getAddress } from "viem";

export interface ResolvedAddress {
  address: Address;
  label: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  description: string | null;
  owner: Address | null;
  aggregator: Address | null;
  aggregatorOwner: Address | null;
  /** ERC4626 underlying asset, when the target is a vault. */
  asset: Address | null;
  /** Symbol of that underlying asset — names the unit a vault ratio is quoted in. */
  assetSymbol: string | null;
}

const ZERO = zeroAddress;

function isZero(addr: Address): boolean {
  return addr === ZERO || addr === "0x" || addr === ("0x" + "0".repeat(40) as Address);
}

const erc20Abi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

const feedAbi = [
  { type: "function", name: "description", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "aggregator", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

const vaultAbi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

async function tryCall<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

export async function resolveAddress(
  client: PublicClient,
  addr: Address,
  hint: "feed" | "vault" | "token" | "unknown" = "unknown",
): Promise<ResolvedAddress> {
  if (isZero(addr)) {
    return {
      address: addr,
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

  const canonical = getAddress(addr);

  // Try all calls in parallel — they'll fail silently if the contract
  // doesn't implement those functions.
  const [symbol, name, decimals, description, owner, aggregator, asset] =
    await Promise.all([
      tryCall(
        client.readContract({
          address: canonical,
          abi: erc20Abi,
          functionName: "symbol",
        }),
      ),
      tryCall(
        client.readContract({
          address: canonical,
          abi: erc20Abi,
          functionName: "name",
        }),
      ),
      tryCall(
        client.readContract({
          address: canonical,
          abi: feedAbi,
          functionName: "decimals",
        }),
      ),
      tryCall(
        client.readContract({
          address: canonical,
          abi: feedAbi,
          functionName: "description",
        }),
      ),
      tryCall(
        client.readContract({
          address: canonical,
          abi: feedAbi,
          functionName: "owner",
        }),
      ),
      tryCall(
        client.readContract({
          address: canonical,
          abi: feedAbi,
          functionName: "aggregator",
        }),
      ),
      tryCall(
        client.readContract({
          address: canonical,
          abi: vaultAbi,
          functionName: "asset",
        }),
      ),
    ]);

  // 2nd hop: if the target is an ERC4626 vault, name its underlying asset.
  // Without this the loan side of a feedless oracle has no human label at all.
  let assetSymbol: string | null = null;
  if (asset && !isZero(asset as Address)) {
    assetSymbol = (await tryCall(
      client.readContract({
        address: asset as Address,
        abi: erc20Abi,
        functionName: "symbol",
      }),
    )) as string | null;
  }

  // 2nd hop: if we got an aggregator, resolve its owner
  let aggregatorOwner: Address | null = null;
  if (aggregator && !isZero(aggregator)) {
    aggregatorOwner = await tryCall(
      client.readContract({
        address: aggregator,
        abi: feedAbi,
        functionName: "owner",
      }),
    );
  }

  // Build a label from whatever we got
  let label: string | null = null;
  if (description) label = description as string;
  else if (symbol && name) label = `${name} (${symbol})`;
  else if (symbol) label = symbol as string;
  else if (name) label = name as string;

  return {
    address: canonical,
    label,
    symbol: (symbol as string) ?? null,
    name: (name as string) ?? null,
    decimals: decimals != null ? Number(decimals) : null,
    description: (description as string) ?? null,
    owner: owner ? getAddress(owner as Address) : null,
    aggregator: aggregator ? getAddress(aggregator as Address) : null,
    aggregatorOwner: aggregatorOwner
      ? getAddress(aggregatorOwner as Address)
      : null,
    asset: asset && !isZero(asset as Address) ? getAddress(asset as Address) : null,
    assetSymbol,
  };
}
