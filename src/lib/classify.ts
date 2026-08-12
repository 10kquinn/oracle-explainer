/**
 * Oracle family classification from ABI selectors.
 */

export type OracleFamily = "morpho" | "morpho-meta" | "chainlink" | "euler" | "aave" | "unknown";

interface AbiItem {
  type?: string;
  name?: string;
  inputs?: { type: string }[];
  outputs?: { type: string }[];
  stateMutability?: string;
}

function hasFunction(
  abi: readonly Record<string, unknown>[],
  name: string,
  inputTypes: string[] = [],
): boolean {
  return (abi as unknown as AbiItem[]).some(
    (item) =>
      item.type === "function" &&
      item.name === name &&
      (item.inputs ?? []).length === inputTypes.length &&
      inputTypes.every((t, i) => item.inputs![i].type === t),
  );
}

export function classifyOracle(
  abi: readonly Record<string, unknown>[],
): OracleFamily {
  // Steakhouse MetaOracleDeviationTimelock: wraps two IOracle with deviation switching
  if (
    hasFunction(abi, "price", []) &&
    hasFunction(abi, "primaryOracle", []) &&
    hasFunction(abi, "backupOracle", []) &&
    hasFunction(abi, "deviationThreshold", [])
  ) {
    return "morpho-meta";
  }

  // Morpho IOracle: price() -> uint256, no inputs
  if (
    hasFunction(abi, "price", []) &&
    hasFunction(abi, "SCALE_FACTOR", [])
  ) {
    return "morpho";
  }

  // Chainlink AggregatorV3Interface
  if (hasFunction(abi, "latestRoundData", [])) {
    return "chainlink";
  }

  // Euler EVK
  if (hasFunction(abi, "getQuote", ["uint256", "address", "address"])) {
    return "euler";
  }

  // Aave
  if (hasFunction(abi, "getAssetPrice", ["address"])) {
    return "aave";
  }

  return "unknown";
}
