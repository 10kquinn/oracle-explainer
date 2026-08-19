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
import {
  morphoMetaAdapter,
  readMetaOracleLiveValues,
} from "../adapters/morpho-meta";
import { buildHumanPrice } from "./format";
import type { OracleExplanation, PricingPath } from "./types";

/**
 * A pass-through wrapper has no decimals of its own to invert. Reuse the
 * scaling the active underlying oracle established, and recompute the decimal
 * value from the wrapper's own verified price — never copy the inner number.
 */
function attachDelegatedHumanPrice(
  pricingPath: PricingPath,
  underlying: Record<string, OracleExplanation>,
): PricingPath {
  const activeRole =
    pricingPath.derived.activeOracle === "backup" ? "backup" : "primary";
  const ordered = [activeRole, activeRole === "primary" ? "backup" : "primary"];

  for (const role of ordered) {
    const ref = underlying[role]?.pricingPath.humanPrice;
    if (!ref) continue;
    return {
      ...pricingPath,
      humanPrice: buildHumanPrice({
        raw: pricingPath.recomputedPrice,
        exponent: ref.exponent,
        baseSymbol: ref.baseSymbol,
        quoteSymbol: ref.quoteSymbol,
        basis:
          `This wrapper returns the ${activeRole} oracle's price unchanged, so it inherits that ` +
          `oracle's scaling. ${ref.basis}`,
      }),
    };
  }
  return pricingPath;
}

export async function explainOracle(
  address: string,
  chainId: number,
): Promise<OracleExplanation> {
  const client = getClient(chainId);
  const addr = getAddress(address) as Address;

  // Step 1: Resolve proxy if applicable
  const implAddr = await resolveImplementation(client, addr);

  // Step 2: Fetch contract source + ABI from Etherscan
  // Try the address directly first. If Etherscan flags it as a proxy,
  // fetch the implementation's ABI instead (covers EIP-1967, UUPS, etc.)
  let contractInfo = await getContractSource(chainId, addr);

  if (implAddr) {
    // EIP-1967 proxy detected — fetch implementation ABI
    contractInfo = await getContractSource(chainId, implAddr);
  } else if (contractInfo.isProxy && contractInfo.implementation) {
    // Etherscan flagged as proxy — use their resolved implementation
    const implInfo = await getContractSource(
      chainId,
      contractInfo.implementation,
    );
    contractInfo = implInfo;
  }

  // Step 3: Classify oracle family
  const family = classifyOracle(contractInfo.abi);

  if (family === "unknown") {
    throw new Error(
      `Unknown oracle family for ${contractInfo.name}. ` +
        `ABI selectors do not match any known oracle family.`,
    );
  }

  if (family !== "morpho" && family !== "morpho-meta") {
    throw new Error(
      `Oracle family "${family}" is not yet supported. Only Morpho oracles are implemented in v1.`,
    );
  }

  // Step 4: Read all config via multicall
  const { config, resolved } = await readOracleConfig(
    client,
    addr,
    contractInfo.abi,
  );

  // Step 5+6: Read live values and run family-specific adapter
  let pricingPath: PricingPath;
  let underlyingOracles: Record<string, OracleExplanation> | undefined;

  if (family === "morpho-meta") {
    const liveValues = await readMetaOracleLiveValues(client, addr);
    pricingPath = morphoMetaAdapter(config, resolved, liveValues);

    // Recursively explain both underlying oracles
    const primaryAddr = config.primaryOracle as string;
    const backupAddr = config.backupOracle as string;
    if (primaryAddr && backupAddr) {
      const [primaryExplanation, backupExplanation] = await Promise.all([
        explainOracle(primaryAddr, chainId).catch(() => null),
        explainOracle(backupAddr, chainId).catch(() => null),
      ]);
      underlyingOracles = {};
      if (primaryExplanation) underlyingOracles.primary = primaryExplanation;
      if (backupExplanation) underlyingOracles.backup = backupExplanation;

      // The wrapper passes the active oracle's price through untouched, so it
      // shares that oracle's scaling. Borrow the exponent and token labels the
      // underlying adapter already derived rather than leaving the human
      // price blank on the outer card.
      pricingPath = attachDelegatedHumanPrice(pricingPath, underlyingOracles);
    }
  } else {
    const liveValues = await readMorphoLiveValues(client, config);
    pricingPath = morphoAdapter(config, resolved, liveValues);
  }

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
    prose: null,
    underlyingOracles,
  };
}
