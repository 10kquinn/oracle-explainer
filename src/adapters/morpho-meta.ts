/**
 * Steakhouse MetaOracleDeviationTimelock adapter.
 *
 * A safety wrapper that implements Morpho's IOracle interface and selects
 * between a primary and backup oracle. It switches to backup when prices
 * diverge beyond a threshold for a sustained challenge period, and switches
 * back when they reconverge for a healing period.
 *
 * price() delegates to whichever oracle is currently active (primary or backup),
 * with a try/catch fallback to the other if the active one reverts.
 */

import { type Address, type PublicClient } from "viem";
import type {
  RawConfig,
  ResolvedDependencies,
  PricingPath,
  PricingComponent,
} from "../lib/types";

export interface MetaOracleLiveValues {
  /** Price from the currently active oracle */
  currentPrice: bigint;
  /** Price from the primary oracle */
  primaryPrice: bigint;
  /** Price from the backup oracle */
  backupPrice: bigint;
  /** Current deviation between primary and backup (scaled 1e18) */
  deviation: bigint;
  /** Whether deviation exceeds threshold */
  isDeviant: boolean;
  /** Whether primary is the active oracle */
  isPrimary: boolean;
  /** Whether a challenge is in progress */
  isChallenged: boolean;
  /** Whether healing is in progress */
  isHealing: boolean;
}

export function morphoMetaAdapter(
  config: RawConfig,
  resolved: ResolvedDependencies,
  live: MetaOracleLiveValues,
): PricingPath {
  const deviationThreshold = config.deviationThreshold as bigint;
  const challengeDuration = config.challengeTimelockDuration as bigint;
  const healingDuration = config.healingTimelockDuration as bigint;

  const primaryLabel = resolved.primaryOracle?.label ?? "Primary oracle";
  const backupLabel = resolved.backupOracle?.label ?? "Backup oracle";
  const activeLabel = live.isPrimary ? primaryLabel : backupLabel;

  // The recomputed price is simply the active oracle's price
  const recomputedPrice = live.currentPrice;

  // Format deviation as percentage
  const deviationPct = Number(live.deviation) / 1e16; // 1e18 scale -> percentage

  const components: PricingComponent[] = [
    {
      name: "Active oracle",
      role: "numerator",
      value: live.currentPrice,
      source: `${activeLabel}.price() = ${live.currentPrice.toString()} (${live.isPrimary ? "primary" : "backup"})`,
    },
    {
      name: "Primary oracle",
      role: "numerator",
      value: live.primaryPrice,
      source: `${primaryLabel}.price() = ${live.primaryPrice.toString()}`,
    },
    {
      name: "Backup oracle",
      role: "numerator",
      value: live.backupPrice,
      source: `${backupLabel}.price() = ${live.backupPrice.toString()}`,
    },
  ];

  // Build formula
  const formula = `price = ${activeLabel}.price()  [currently using ${live.isPrimary ? "primary" : "backup"}]`;

  // Build derived
  const derived: Record<string, unknown> = {
    activeOracle: live.isPrimary ? "primary" : "backup",
    currentDeviationPct: `${deviationPct.toFixed(4)}%`,
    deviationThresholdPct: `${Number(deviationThreshold) / 1e16}%`,
    challengeTimelockSeconds: Number(challengeDuration),
    healingTimelockSeconds: Number(healingDuration),
    isDeviant: live.isDeviant,
    isChallenged: live.isChallenged,
    isHealing: live.isHealing,
    status: getStatus(live),
  };

  return {
    formula,
    recomputedPrice,
    components,
    caveats: META_ORACLE_CAVEATS,
    derived,
  };
}

function getStatus(live: MetaOracleLiveValues): string {
  if (live.isPrimary && !live.isChallenged && !live.isDeviant) {
    return "Normal — using primary oracle, prices converged";
  }
  if (live.isPrimary && live.isDeviant && !live.isChallenged) {
    return "Deviant — primary is active but prices are diverging, challenge can be initiated";
  }
  if (live.isPrimary && live.isChallenged) {
    return "Challenged — primary is active, challenge timelock is ticking";
  }
  if (!live.isPrimary && !live.isHealing && live.isDeviant) {
    return "Failover — using backup oracle, prices still diverged";
  }
  if (!live.isPrimary && !live.isDeviant && !live.isHealing) {
    return "Converged on backup — prices have reconverged, healing can be initiated";
  }
  if (!live.isPrimary && live.isHealing) {
    return "Healing — backup is active, healing timelock is ticking to return to primary";
  }
  return "Unknown state";
}

/**
 * Read the live values needed by the MetaOracle adapter.
 */
export async function readMetaOracleLiveValues(
  client: PublicClient,
  address: Address,
): Promise<MetaOracleLiveValues> {
  const metaAbi = [
    { type: "function", name: "price", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "primaryPrice", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "backupPrice", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "getDeviation", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "isDeviant", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
    { type: "function", name: "isPrimary", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
    { type: "function", name: "isChallenged", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
    { type: "function", name: "isHealing", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  ] as const;

  const results = await client.multicall({
    contracts: [
      { address, abi: metaAbi, functionName: "price" },
      { address, abi: metaAbi, functionName: "primaryPrice" },
      { address, abi: metaAbi, functionName: "backupPrice" },
      { address, abi: metaAbi, functionName: "getDeviation" },
      { address, abi: metaAbi, functionName: "isDeviant" },
      { address, abi: metaAbi, functionName: "isPrimary" },
      { address, abi: metaAbi, functionName: "isChallenged" },
      { address, abi: metaAbi, functionName: "isHealing" },
    ],
  });

  return {
    currentPrice: (results[0].result as bigint) ?? 0n,
    primaryPrice: (results[1].result as bigint) ?? 0n,
    backupPrice: (results[2].result as bigint) ?? 0n,
    deviation: (results[3].result as bigint) ?? 0n,
    isDeviant: (results[4].result as boolean) ?? false,
    isPrimary: (results[5].result as boolean) ?? true,
    isChallenged: (results[6].result as boolean) ?? false,
    isHealing: (results[7].result as boolean) ?? false,
  };
}

const META_ORACLE_CAVEATS: string[] = [
  "The MetaOracle does not validate the correctness of either underlying oracle — it only compares them against each other. If both oracles are wrong in the same direction, no deviation is detected.",
  "Switching between primary and backup is not automatic. Someone must call challenge(), wait for the timelock, then call acceptChallenge(). During the timelock period the potentially stale primary oracle remains active.",
  "The deviation calculation uses the average of both prices as the denominator. If one price is zero or near-zero, the deviation metric may not behave intuitively.",
  "The try/catch fallback in price() means a reverting active oracle silently falls through to the other oracle. This is a safety feature but means the consumer cannot distinguish between normal operation and fallback mode from the return value alone.",
  "Feed staleness and min/max bounds are not checked at this layer — those properties depend entirely on the underlying oracles.",
];
