/**
 * Chain registry — display metadata only.
 *
 * Deliberately free of any viem import so the client bundle can use it without
 * pulling in 27 chain definitions. `chains.ts` pairs each id here with its viem
 * chain object on the server.
 *
 * Membership is not a matter of taste: a chain earns a row only if Etherscan's
 * v2 multichain API serves it. Without `getsourcecode` there is no ABI, without
 * an ABI there is no classification, and the pipeline cannot get past step two.
 * The list below was taken from https://api.etherscan.io/v2/chainlist, and
 * every entry was confirmed status=1 with a viem definition carrying
 * Multicall3 (the config reader batches through it).
 *
 * Explorer URLs come from that same response rather than being typed from
 * memory, since they are what every address link on the page resolves to.
 */

export interface ChainMeta {
  id: number;
  /** Short label for the picker. */
  name: string;
  /** Block explorer origin, no trailing slash. */
  explorer: string;
}

export const CHAIN_META: readonly ChainMeta[] = [
  { id: 1, name: "Ethereum", explorer: "https://etherscan.io" },
  { id: 8453, name: "Base", explorer: "https://basescan.org" },
  { id: 42161, name: "Arbitrum", explorer: "https://arbiscan.io" },
  { id: 10, name: "Optimism", explorer: "https://optimistic.etherscan.io" },
  { id: 137, name: "Polygon", explorer: "https://polygonscan.com" },
  { id: 130, name: "Unichain", explorer: "https://uniscan.xyz" },
  { id: 59144, name: "Linea", explorer: "https://lineascan.build" },
  { id: 81457, name: "Blast", explorer: "https://blastscan.io" },
  { id: 5000, name: "Mantle", explorer: "https://mantlescan.xyz" },
  { id: 146, name: "Sonic", explorer: "https://sonicscan.org" },
  { id: 80094, name: "Berachain", explorer: "https://berascan.com" },
  { id: 143, name: "Monad", explorer: "https://monadscan.com" },
  { id: 9745, name: "Plasma", explorer: "https://plasmascan.to" },
  { id: 999, name: "HyperEVM", explorer: "https://hyperevmscan.io" },
  { id: 747474, name: "Katana", explorer: "https://katanascan.com" },
  { id: 480, name: "World Chain", explorer: "https://worldscan.org" },
  { id: 1329, name: "Sei", explorer: "https://seiscan.io" },
  { id: 4326, name: "MegaETH", explorer: "https://mega.etherscan.io" },
  { id: 2741, name: "Abstract", explorer: "https://abscan.org" },
  { id: 167000, name: "Taiko", explorer: "https://taikoscan.io" },
  { id: 33139, name: "ApeChain", explorer: "https://apescan.io" },
  { id: 252, name: "Fraxtal", explorer: "https://fraxscan.com" },
  { id: 42220, name: "Celo", explorer: "https://celoscan.io" },
  { id: 100, name: "Gnosis", explorer: "https://gnosisscan.io" },
  { id: 43114, name: "Avalanche", explorer: "https://snowscan.xyz" },
  { id: 56, name: "BNB Chain", explorer: "https://bscscan.com" },
  { id: 204, name: "opBNB", explorer: "https://opbnb.bscscan.com" },
];

export const DEFAULT_CHAIN_ID = 1;

const BY_ID = new Map(CHAIN_META.map((c) => [c.id, c]));

export function chainMeta(chainId: number): ChainMeta | undefined {
  return BY_ID.get(chainId);
}

export function chainName(chainId: number): string {
  return BY_ID.get(chainId)?.name ?? `Chain ${chainId}`;
}

export function explorerFor(chainId: number): string {
  return BY_ID.get(chainId)?.explorer ?? "https://etherscan.io";
}
