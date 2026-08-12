# Oracle Explainer

Paste an oracle contract address, get a verified plain-English explanation of how it prices, what it assumes, and what it doesn't check.

Built for curator-style due diligence on lending-market oracles, where the question "what actually determines this collateral's reported value" needs answering in minutes rather than an afternoon.

## How it works

```
address + chain
  -> resolve proxy (EIP-1967 / Etherscan detection)
  -> fetch ABI + source from Etherscan
  -> classify oracle family from ABI selectors
  -> multicall every zero-arg view getter
  -> resolve address-typed dependencies 1-2 hops deep
  -> family adapter computes pricing path deterministically
  -> verify: recomputed price == live on-chain call (exact match required)
  -> LLM writes prose from the structured result (only if verified)
```

The LLM never computes a price. Adapters do arithmetic, the model does English. If the adapter's recomputed price doesn't exactly match the live `price()` call, the explanation is withheld and the mismatch is shown plainly.

## Supported oracle families

| Family | Contract | Status |
|---|---|---|
| Morpho | `MorphoChainlinkOracleV2` | Supported |
| Morpho Meta | `MetaOracleDeviationTimelock` | Supported (recursive — resolves underlying oracles) |
| Chainlink | `AggregatorV3Interface` | Planned |
| Euler | EVK oracles | Planned |
| Aave | Aave oracles | Planned |

## Setup

```bash
git clone https://github.com/10kquinn/oracle-explainer.git
cd oracle-explainer
npm install
cp .env.local.example .env.local
# Fill in your keys (see below)
npm run dev
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `ETHERSCAN_API_KEY` | Yes | Free key from [etherscan.io/myapikey](https://etherscan.io/myapikey) |
| `ETH_RPC_URL` | Recommended | Ethereum RPC endpoint (e.g. Alchemy, Infura). Falls back to public RPC if unset. |
| `BASE_RPC_URL` | For Base | Base chain RPC endpoint |
| `ANTHROPIC_API_KEY` | For prose | Enables the plain-English explanation. Without it you still get the full structured breakdown. |

## Deploy to Vercel

1. Push to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Add the environment variables above in the Vercel dashboard
4. Deploy

## Development

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm test         # Run golden fixture tests
```

## Stack

- **Next.js** — app router, API routes
- **viem** — chain interaction, multicall batching
- **Etherscan v2 API** — contract source, ABI, creation info (single key, all chains)
- **Anthropic API** — prose generation only (Claude Sonnet)
- **Tailwind CSS** — styling
