/**
 * The explain pipeline.
 * Orchestrates: resolve proxy -> fetch source -> classify -> read config
 * -> resolve deps -> adapter -> verify -> (optional) LLM prose.
 *
 * The pipeline never throws for an address it cannot fully explain. Every
 * address lands in a tier (see ExplanationTier) and every tier produces plain
 * English — but only a tier whose pricing path was recomputed and matched
 * exactly is allowed to describe a pricing mechanism.
 */

import { type Address, getAddress } from "viem";
import { getClient } from "./chains";
import {
  getContractSource,
  getContractCreation,
  ContractNotVerifiedError,
} from "./etherscan";
import { resolveImplementation } from "./proxy";
import { classifyOracle } from "./classify";
import { readOracleConfig, readLivePrice } from "./reader";
import { morphoAdapter, readMorphoLiveValues } from "../adapters/morpho";
import {
  morphoMetaAdapter,
  readMetaOracleLiveValues,
} from "../adapters/morpho-meta";
import {
  chainlinkAdapter,
  readChainlinkLiveValues,
  chainlinkEntrypointValue,
  chainlinkCrossCheckAvailable,
} from "../adapters/chainlink";
import { describeUnverified, describeOpaque } from "./describe";
import { buildHumanPrice } from "./format";
import type {
  ExplanationTier,
  OracleExplanation,
  PricingPath,
} from "./types";

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
    const ref = underlying[role]?.pricingPath?.humanPrice;
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

  // Creator info is useful in every tier, including the opaque one.
  const creator = await getContractCreation(chainId, addr)
    .then((c) => ({ address: c.creator, txHash: c.txHash }))
    .catch(() => null);

  // Step 1: Resolve proxy if applicable
  const implAddr = await resolveImplementation(client, addr);

  // Step 2: Fetch contract source + ABI. Unverified source is a terminal tier,
  // not an error — report provenance and stop.
  let contractInfo;
  try {
    contractInfo = await getContractSource(chainId, addr);

    if (implAddr) {
      // EIP-1967 proxy detected — fetch implementation ABI
      contractInfo = await getContractSource(chainId, implAddr);
    } else if (contractInfo.isProxy && contractInfo.implementation) {
      // Etherscan flagged as proxy — use their resolved implementation
      contractInfo = await getContractSource(
        chainId,
        contractInfo.implementation,
      );
    }
  } catch (err) {
    // Only an actually-unpublished source is the opaque tier. Anything else —
    // a throttled explorer, a network blip — is our problem, not a finding
    // about the contract, and gets surfaced as a failed request the user can
    // retry rather than a verdict they might write down.
    if (!(err instanceof ContractNotVerifiedError)) {
      throw err;
    }

    const reason = err.message;
    return {
      address: addr,
      chainId,
      family: "unknown",
      contractName: "Unverified contract",
      config: {},
      resolved: {},
      pricingPath: null,
      livePrice: null,
      verified: false,
      tier: "opaque",
      explanation: describeOpaque({ address: addr, reason }),
      limitation: `Source code is not available: ${reason}`,
      creator,
      prose: null,
      proseError: null,
    };
  }

  // Step 3: Classify oracle family
  const family = classifyOracle(contractInfo.abi);

  // Step 4: Read all config via multicall. This works for any ABI, which is
  // what makes the described tier possible.
  const { config, resolved } = await readOracleConfig(
    client,
    addr,
    contractInfo.abi,
  );

  const base = {
    address: addr,
    chainId,
    family,
    contractName: contractInfo.name,
    config,
    resolved,
    creator,
    prose: null,
    proseError: null,
  };

  // Step 5: Families with no adapter stop at a description. Their entrypoints
  // take arguments (Euler, Aave) or are simply unrecognised, so there is no
  // single value to recompute and check.
  if (family !== "morpho" && family !== "morpho-meta" && family !== "chainlink") {
    return {
      ...base,
      pricingPath: null,
      livePrice: null,
      verified: false,
      tier: "described",
      explanation: describeUnverified({
        address: addr,
        contractName: contractInfo.name,
        family,
        config,
        resolved,
      }),
      limitation:
        family === "unknown"
          ? "ABI does not match a known oracle family, so no pricing path could be computed."
          : `The ${family} family is recognised but has no adapter yet, so its pricing path could not be recomputed.`,
    };
  }

  // Step 6: Run the family adapter and read the entrypoint it must match.
  let pricingPath: PricingPath;
  let livePrice: bigint;
  let underlyingOracles: Record<string, OracleExplanation> | undefined;

  try {
    if (family === "morpho-meta") {
      const liveValues = await readMetaOracleLiveValues(client, addr);
      pricingPath = morphoMetaAdapter(config, resolved, liveValues);
      livePrice = await readLivePrice(client, addr);

      const primaryAddr = config.primaryOracle as string;
      const backupAddr = config.backupOracle as string;
      if (primaryAddr && backupAddr) {
        const primaryExplanation = await explainOracle(
          primaryAddr,
          chainId,
        ).catch(() => null);
        const backupExplanation = await explainOracle(
          backupAddr,
          chainId,
        ).catch(() => null);
        underlyingOracles = {};
        if (primaryExplanation) underlyingOracles.primary = primaryExplanation;
        if (backupExplanation) underlyingOracles.backup = backupExplanation;
        pricingPath = attachDelegatedHumanPrice(pricingPath, underlyingOracles);
      }
    } else if (family === "chainlink") {
      const liveValues = await readChainlinkLiveValues(client, addr, config);

      // No independent read means there is nothing to verify against. Report
      // that honestly instead of comparing the answer to itself (a fake pass)
      // or to a sentinel (a fake mismatch that blames the parser).
      if (!chainlinkCrossCheckAvailable(liveValues)) {
        return {
          ...base,
          pricingPath: null,
          livePrice: null,
          verified: false,
          tier: "described",
          explanation: describeUnverified({
            address: addr,
            contractName: contractInfo.name,
            family,
            config,
            resolved,
          }),
          limitation:
            "The answer could not be independently confirmed: the underlying aggregator " +
            "restricts reads to whitelisted callers, and the feed did not serve a replay of " +
            "its own latest round. The value it reports is shown below, but nothing here " +
            "corroborates it.",
        };
      }

      pricingPath = chainlinkAdapter(config, resolved, liveValues);
      livePrice = chainlinkEntrypointValue(liveValues);
    } else {
      const liveValues = await readMorphoLiveValues(client, config);
      pricingPath = morphoAdapter(config, resolved, liveValues);
      livePrice = await readLivePrice(client, addr);
    }
  } catch (err) {
    // The adapter or one of its reads failed. Fall back to a description
    // rather than surfacing a stack trace as the whole answer.
    const reason = err instanceof Error ? err.message : "unknown error";
    return {
      ...base,
      pricingPath: null,
      livePrice: null,
      verified: false,
      tier: "described",
      explanation: describeUnverified({
        address: addr,
        contractName: contractInfo.name,
        family,
        config,
        resolved,
      }),
      limitation: `The pricing path could not be computed: ${reason}`,
    };
  }

  // Step 7: The verification gate.
  const verified = pricingPath.recomputedPrice === livePrice;
  const tier: ExplanationTier = verified ? "verified-path" : "path-mismatch";

  return {
    ...base,
    pricingPath,
    livePrice,
    verified,
    tier,
    // A mismatch means the parse is wrong, so the adapter's narrative is not
    // trustworthy and must not be shown. Swap in the description instead.
    explanation: verified
      ? pricingPath.formulaExplanation
      : describeUnverified({
          address: addr,
          contractName: contractInfo.name,
          family,
          config,
          resolved,
          mismatch: {
            recomputed: pricingPath.recomputedPrice,
            live: livePrice,
          },
        }),
    limitation: verified
      ? null
      : "The recomputed value does not match the live call, so the pricing path is not trustworthy.",
    underlyingOracles,
  };
}
