import type { Address } from "viem";
import type { ResolvedAddress } from "./resolve";
import type { HumanPrice } from "./format";

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
  /**
   * Deterministic plain-English reading of the formula. Written by the adapter
   * from parsed config, not by the model.
   */
  formulaExplanation: FormulaExplanation;
  /** The recomputed price as a bigint */
  recomputedPrice: bigint;
  /**
   * The recomputed price rescaled out of Morpho's 36-decimal convention into a
   * ratio a human reads. Null when the scaling exponent could not be derived.
   */
  humanPrice: HumanPrice | null;
  /** Structured description of each component */
  components: PricingComponent[];
  /** Standing caveats for this oracle family */
  caveats: string[];
  /** Derived metadata (e.g., inferred decimals) */
  derived: Record<string, unknown>;
}

export interface FormulaExplanation {
  /** One sentence: what the number the oracle returns actually means. */
  summary: string;
  /** Ordered walk through the formula, one step per active term. */
  steps: string[];
  /** Trailing remarks — disabled slots, scaling convention. */
  notes: string[];
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
  /** Recursive explanations of underlying oracles (for wrapper types like MetaOracle) */
  underlyingOracles?: Record<string, OracleExplanation>;
}
