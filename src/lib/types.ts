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

/**
 * How much the tool was able to establish about an address. Every tier gets a
 * plain-English explanation; the tier decides what that explanation is allowed
 * to claim.
 *
 * - `verified-path`  an adapter recomputed the entrypoint and it matched exactly.
 *                    A pricing narrative is permitted.
 * - `path-mismatch`  an adapter ran but its recomputation disagreed with the
 *                    live call. The parse is wrong somewhere; no narrative.
 * - `described`      the contract is verified and its config was read, but no
 *                    adapter can compute its entrypoint. Describe what is
 *                    there; claim nothing about how it prices.
 * - `opaque`         source is unavailable. Report provenance only.
 */
export type ExplanationTier =
  | "verified-path"
  | "path-mismatch"
  | "described"
  | "opaque";

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
  /** Null when no adapter could compute a pricing path for this family. */
  pricingPath: PricingPath | null;
  /** Null when the family has no zero-arg price entrypoint to call. */
  livePrice: bigint | null;
  verified: boolean;
  tier: ExplanationTier;
  /**
   * Always present. For a verified path this is the adapter's formula
   * walkthrough; otherwise it is a description of what could be established,
   * which never asserts a pricing mechanism.
   */
  explanation: FormulaExplanation;
  /** Why there is no verified pricing path, when there isn't one. */
  limitation: string | null;
  /** Creator info */
  creator: { address: string; txHash: string } | null;
  /** LLM-generated prose. Null when generation was skipped or failed. */
  prose: string | null;
  /**
   * Why prose is missing, when it is. Swallowing this made a blank section
   * indistinguishable from a section that was never attempted.
   */
  proseError: string | null;
  /** Recursive explanations of underlying oracles (for wrapper types like MetaOracle) */
  underlyingOracles?: Record<string, OracleExplanation>;
}
