import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import {
  mainnet, base, arbitrum, optimism, polygon, unichain, linea, blast,
  mantle, sonic, berachain, monad, plasma, hyperEvm, katana, worldchain,
  sei, megaeth, abstract as abstractChain, taiko, apeChain, fraxtal,
  celo, gnosis, avalanche, bsc, opBNB,
} from "viem/chains";
import { CHAIN_META, chainName } from "./chain-meta";

const VIEM_CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [polygon.id]: polygon,
  [unichain.id]: unichain,
  [linea.id]: linea,
  [blast.id]: blast,
  [mantle.id]: mantle,
  [sonic.id]: sonic,
  [berachain.id]: berachain,
  [monad.id]: monad,
  [plasma.id]: plasma,
  [hyperEvm.id]: hyperEvm,
  [katana.id]: katana,
  [worldchain.id]: worldchain,
  [sei.id]: sei,
  [megaeth.id]: megaeth,
  [abstractChain.id]: abstractChain,
  [taiko.id]: taiko,
  [apeChain.id]: apeChain,
  [fraxtal.id]: fraxtal,
  [celo.id]: celo,
  [gnosis.id]: gnosis,
  [avalanche.id]: avalanche,
  [bsc.id]: bsc,
  [opBNB.id]: opBNB,
};

/**
 * Per-chain RPC override, by convention: RPC_URL_1, RPC_URL_8453, and so on.
 * Unset means viem's public endpoint for that chain, which works but is rate
 * limited — set an override for any chain expected to take real traffic.
 *
 * ETH_RPC_URL and BASE_RPC_URL predate the convention and still win, so
 * existing deployments keep working without an env change.
 */
function rpcUrl(chainId: number): string | undefined {
  if (chainId === mainnet.id && process.env.ETH_RPC_URL) {
    return process.env.ETH_RPC_URL;
  }
  if (chainId === base.id && process.env.BASE_RPC_URL) {
    return process.env.BASE_RPC_URL;
  }
  return process.env[`RPC_URL_${chainId}`];
}

export const SUPPORTED_CHAINS: readonly number[] = CHAIN_META.map((c) => c.id);

export function isSupportedChain(chainId: number): boolean {
  return chainId in VIEM_CHAINS;
}

export { chainName };

export function getClient(chainId: number): PublicClient {
  const chain = VIEM_CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported chain ${chainId}. Supported: ${CHAIN_META.map((c) => `${c.name} (${c.id})`).join(", ")}`,
    );
  }
  return createPublicClient({
    chain,
    transport: http(rpcUrl(chainId)),
    batch: { multicall: true },
  });
}
