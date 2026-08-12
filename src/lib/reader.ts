/**
 * Oracle config reader.
 * Reads all zero-arg view/pure getters from a contract via multicall,
 * then resolves address-typed return values.
 */

import {
  type Address,
  type PublicClient,
  type Abi,
  getAddress,
} from "viem";
import { resolveAddress, type ResolvedAddress } from "./resolve";
import type { RawConfig, ResolvedDependencies } from "./types";

interface AbiFunction {
  type: string;
  name: string;
  inputs: { type: string }[];
  outputs: { type: string }[];
  stateMutability: string;
}

function getZeroArgGetters(
  abi: readonly Record<string, unknown>[],
): AbiFunction[] {
  return (abi as unknown as AbiFunction[]).filter(
    (item) =>
      item.type === "function" &&
      (item.stateMutability === "view" || item.stateMutability === "pure") &&
      item.inputs.length === 0,
  );
}

function isAddressType(output: { type: string }): boolean {
  return output.type === "address";
}

export async function readOracleConfig(
  client: PublicClient,
  address: Address,
  abi: readonly Record<string, unknown>[],
): Promise<{ config: RawConfig; resolved: ResolvedDependencies }> {
  const getters = getZeroArgGetters(abi);

  // Multicall all zero-arg getters
  const calls = getters.map((fn) => ({
    address,
    abi: [fn] as unknown as Abi,
    functionName: fn.name,
  }));

  const results = await client.multicall({ contracts: calls as any });

  // Build raw config
  const config: RawConfig = {};
  const addressFields: { name: string; value: Address }[] = [];

  for (let i = 0; i < getters.length; i++) {
    const fn = getters[i];
    const result = results[i];

    if (result.status === "failure") {
      config[fn.name] = null;
      continue;
    }

    const value = result.result;
    config[fn.name] = value;

    // Track address-typed returns for resolution
    if (fn.outputs.length === 1 && isAddressType(fn.outputs[0]) && typeof value === "string") {
      addressFields.push({ name: fn.name, value: getAddress(value) as Address });
    }
  }

  // Resolve all address-typed values in parallel
  const hints = inferHints(addressFields);
  const resolvedEntries = await Promise.all(
    addressFields.map(async ({ name, value }) => {
      const resolved = await resolveAddress(client, value, hints[name] ?? "unknown");
      return [name, resolved] as [string, ResolvedAddress];
    }),
  );

  const resolved: ResolvedDependencies = Object.fromEntries(resolvedEntries);

  return { config, resolved };
}

/**
 * Infer resolution hints from field names.
 */
function inferHints(
  fields: { name: string; value: Address }[],
): Record<string, "feed" | "vault" | "token" | "unknown"> {
  const hints: Record<string, "feed" | "vault" | "token" | "unknown"> = {};
  for (const { name } of fields) {
    const lower = name.toLowerCase();
    if (lower.includes("feed")) hints[name] = "feed";
    else if (lower.includes("vault")) hints[name] = "vault";
    else if (lower.includes("token")) hints[name] = "token";
    else hints[name] = "unknown";
  }
  return hints;
}

/**
 * Read the live price from a Morpho oracle.
 */
export async function readLivePrice(
  client: PublicClient,
  address: Address,
): Promise<bigint> {
  const result = await client.readContract({
    address,
    abi: [
      {
        type: "function",
        name: "price",
        inputs: [],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
      },
    ],
    functionName: "price",
  });
  return result as bigint;
}
