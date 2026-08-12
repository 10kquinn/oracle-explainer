/**
 * The explain pipeline.
 * Orchestrates: resolve proxy -> fetch source -> classify -> read config
 * -> resolve deps -> adapter -> verify -> (optional) LLM prose.
 */

import { type Address, getAddress } from "viem";
import { getClient } from "./chains";
import { getContractSource, getContractCreation } from "./etherscan";
import { resolveImplementation } from "./proxy";
import { classifyOracle } from "./classify";
import { readOracleConfig, readLivePrice } from "./reader";
import { morphoAdapter, readMorphoLiveValues } from "../adapters/morpho";
import type { OracleExplanation } from "./types";

export async function explainOracle(
  address: string,
  chainId: number,
): Promise<OracleExplanation> {
  const client = getClient(chainId);
  const addr = getAddress(address) as Address;

  // Step 1: Resolve proxy if applicable
  const implAddr = await resolveImplementation(client, addr);
  const targetAddr = implAddr ?? addr;

  // Step 2: Fetch contract source + ABI from Etherscan
  // If it's a proxy, we need the implementation's ABI but read from the proxy address
  let contractInfo;
  if (implAddr) {
    // Get implementation ABI
    contractInfo = await getContractSource(chainId, implAddr);
  } else {
    contractInfo = await getContractSource(chainId, addr);
  }

  // Step 3: Classify oracle family
  const family = classifyOracle(contractInfo.abi);

  if (family === "unknown") {
    throw new Error(
      `Unknown oracle family for ${contractInfo.name}. ` +
      `ABI selectors do not match any known oracle family.`,
    );
  }

  if (family !== "morpho") {
    throw new Error(
      `Oracle family "${family}" is not yet supported. Only Morpho oracles are implemented in v1.`,
    );
  }

  // Step 4: Read all config via multicall
  const { config, resolved } = await readOracleConfig(
    client,
    addr, // Always read from the proxy address (which delegates to impl)
    contractInfo.abi,
  );

  // Step 5: Read live values for the adapter
  const liveValues = await readMorphoLiveValues(client, config);

  // Step 6: Run the adapter
  const pricingPath = morphoAdapter(config, resolved, liveValues);

  // Step 7: Read the live price for verification
  const livePrice = await readLivePrice(client, addr);

  // Step 8: Verify
  const verified = pricingPath.recomputedPrice === livePrice;

  // Step 9: Get creator info
  let creator: { address: string; txHash: string } | null = null;
  try {
    const creation = await getContractCreation(chainId, addr);
    creator = { address: creation.creator, txHash: creation.txHash };
  } catch {
    // Non-critical — some chains or contracts may not have this
  }

  return {
    address: addr,
    chainId,
    family,
    contractName: contractInfo.name,
    config,
    resolved,
    pricingPath,
    livePrice,
    verified,
    creator,
    prose: null, // LLM prose is added in the API route
  };
}
