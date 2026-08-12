import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { mainnet, base } from "viem/chains";

const RPC_URLS: Record<number, string | undefined> = {
  [mainnet.id]: process.env.ETH_RPC_URL,
  [base.id]: process.env.BASE_RPC_URL,
};

const CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
};

export const CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: "Ethereum",
  [base.id]: "Base",
};

export const SUPPORTED_CHAINS = Object.keys(CHAINS).map(Number);

export function getClient(chainId: number): PublicClient {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  return createPublicClient({
    chain,
    transport: http(RPC_URLS[chainId]),
    batch: { multicall: true },
  });
}
