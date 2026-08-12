/**
 * Etherscan v2 multichain API client.
 * Single API key works across all chains via the v2 endpoint.
 */

const BASE_URL = "https://api.etherscan.io/v2/api";

interface EtherscanSourceResult {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  EVMVersion: string;
  Library: string;
  LicenseType: string;
  Proxy: string;
  Implementation: string;
  SwarmSource: string;
}

export interface ContractInfo {
  name: string;
  abi: readonly Record<string, unknown>[];
  source: string;
  constructorArgs: string;
  isProxy: boolean;
  implementation: string;
  compilerVersion: string;
}

async function etherscanFetch(
  chainId: number,
  params: Record<string, string>,
): Promise<unknown> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY not set");

  const url = new URL(BASE_URL);
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Etherscan HTTP ${res.status}`);
  const json = (await res.json()) as { status: string; result: unknown; message: string };

  if (json.status !== "1") {
    throw new Error(`Etherscan error: ${json.message} — ${JSON.stringify(json.result)}`);
  }

  return json.result;
}

export async function getContractSource(
  chainId: number,
  address: string,
): Promise<ContractInfo> {
  const result = (await etherscanFetch(chainId, {
    module: "contract",
    action: "getsourcecode",
    address,
  })) as EtherscanSourceResult[];

  const r = result[0];
  if (!r || !r.ABI || r.ABI === "Contract source code not verified") {
    throw new Error(`Contract not verified: ${address}`);
  }

  return {
    name: r.ContractName,
    abi: JSON.parse(r.ABI),
    source: r.SourceCode,
    constructorArgs: r.ConstructorArguments,
    isProxy: r.Proxy === "1",
    implementation: r.Implementation,
    compilerVersion: r.CompilerVersion,
  };
}

export async function getContractCreation(
  chainId: number,
  address: string,
): Promise<{ creator: string; txHash: string }> {
  const result = (await etherscanFetch(chainId, {
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: address,
  })) as { contractCreator: string; txHash: string }[];

  const r = result[0];
  if (!r) throw new Error(`No creation info for ${address}`);
  return { creator: r.contractCreator, txHash: r.txHash };
}
