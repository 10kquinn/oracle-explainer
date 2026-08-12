import type { Address } from "viem";
import type { ResolvedAddress } from "./resolve";

export type OracleFamily = "morpho" | "morpho-meta" | "chainlink" | "euler" | "aave" | "unknown";

/**
 * Raw config read from the oracle contract's view getters.
 * Keys are getter names, values are raw return values.
 */
export type RawConfig = Record<string, unknown>;

/**
 * A resolved dependency — an address-typed config value enriched with metadata.
 */
export type ResolvedDependencies = Record<string, ResolvedAddress>;

/**
 * Output of a family adapter's deterministic pricing-path computation.
 */
export interface PricingPath {
  /** Human-readable formula string */
  formula: string;
  /** The recomputed price as a bigint */
  recomputedPrice: bigint;
  /** Structured description of each component */
  components: PricingComponent[];
  /** Standing caveats for this oracle family */
  caveats: string[];
  /** Derived metadata (e.g., inferred decimals) */
  derived: Record<string, unknown>;
}

export interface PricingComponent {
  name: string;
  role: "numerator" | "denominator";
  value: bigint;
  source: string; // e.g. "sUSDe.convertToAssets(1e8)" or "identity (zero address)"
}

/**
 * Full result of the explain pipeline.
 */
export interface OracleExplanation {
  address: Address;
  chainId: number;
  family: OracleFamily;
  contractName: string;
  config: RawConfig;
  resolved: ResolvedDependencies;
  pricingPath: PricingPath;
  livePrice: bigint;
  verified: boolean;
  /** Creator info */
  creator: { address: string; txHash: string } | null;
  /** LLM-generated prose (null if unverified) */
  prose: string | null;
}
