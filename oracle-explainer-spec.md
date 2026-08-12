# Oracle Explainer — design spec and handoff

Context carried over from a chat session. This file exists so a fresh Claude Code session
starts with the reasoning already established rather than re-deriving it.

---

## 1. Goal

A web tool: paste an oracle contract address (+ chain), get back, rapidly:

- the contract's configuration, with every dependency address resolved to a human name
- the pricing formula, written out
- a verified-against-chain badge
- four paragraphs of plain English: how it prices, what it assumes, what it does not
  check, and who can change what

Primary use case is curator-style due diligence on lending-market oracles, where the
question "what actually determines this collateral's reported value" needs answering in
minutes rather than an afternoon.

---

## 2. Architecture

```
address + chain
  -> resolve proxy (EIP-1967 implementation slot) if the target is a proxy
  -> Etherscan getsourcecode: contract name, ABI, source, constructor args
  -> classify oracle family from ABI selectors
  -> multicall every zero-arg view getter
  -> recursively resolve address-typed return values, 1-2 hops
       (symbol / description / decimals / name / owner on each)
  -> family adapter computes the pricing path deterministically
  -> VERIFY: recomputed value == live entrypoint call
  -> LLM writes the prose from the structured result
```

### Family fingerprinting

Classification is cheap because entrypoints are distinctive selectors:

| Signature | Family |
|---|---|
| `price() -> uint256` | Morpho `IOracle` |
| `latestRoundData()` | Chainlink `AggregatorV3Interface` and lookalikes |
| `getQuote(uint256,address,address)` | Euler EVK |
| `getAssetPrice(address)` | Aave |
| `getPrice()` no-arg | assorted bespoke wrappers |

Note that "implements `AggregatorV3Interface`" is a shape, not a provenance claim. A
project-deployed push oracle and a real Chainlink DON feed are indistinguishable by ABI.
Separating them requires `aggregator()` / `owner()` inspection — see §5.

---

## 3. The core design decision: determinism

Do not hand raw source to the model and ask it to explain how the contract prices. It
will produce something fluent, plausible, and occasionally wrong, with no signal
distinguishing the wrong ones. That failure mode is unacceptable for output destined for
a risk memo.

Instead: **adapters do arithmetic, the model does English.**

The verification gate is what makes this safe. If the adapter's recomputed price does not
exactly equal the live `price()` call, the adapter has misparsed something. Fail loudly.
This is the same discipline as verifying a hand-derivation by reproducing all 37 digits of
the on-chain return value.

---

## 4. Reference implementation: the Morpho adapter

`MorphoChainlinkOracleV2` (canonical source: `morpho-org/morpho-blue-oracles`,
`src/morpho-chainlink/MorphoChainlinkOracleV2.sol`).

### Entrypoint

```solidity
function price() external view returns (uint256) {
    return SCALE_FACTOR.mulDiv(
        BASE_VAULT.getAssets(BASE_VAULT_CONVERSION_SAMPLE)   * BASE_FEED_1.getPrice()  * BASE_FEED_2.getPrice(),
        QUOTE_VAULT.getAssets(QUOTE_VAULT_CONVERSION_SAMPLE) * QUOTE_FEED_1.getPrice() * QUOTE_FEED_2.getPrice()
    );
}
```

### The sentinel behaviour that matters

Both helper libraries return **1**, not 0, for the zero address. Miss this and you
conclude the oracle returns zero and is broken.

```solidity
// VaultLib
function getAssets(IERC4626 vault, uint256 shares) internal view returns (uint256) {
    if (address(vault) == address(0)) return 1;
    return vault.convertToAssets(shares);
}

// ChainlinkDataFeedLib
function getPrice(AggregatorV3Interface feed) internal view returns (uint256) {
    if (address(feed) == address(0)) return 1;
    (, int256 answer,,,) = feed.latestRoundData();
    require(answer >= 0, ErrorsLib.NEGATIVE_ANSWER);
    return uint256(answer);
}

function getDecimals(AggregatorV3Interface feed) internal view returns (uint256) {
    if (address(feed) == address(0)) return 0;   // note: 0 decimals, not 18
    return feed.decimals();
}
```

A zero feed therefore contributes a multiplicative identity and drops out of the equation
entirely. A zero `QUOTE_FEED_1` means the loan asset is hardcoded at parity — no market
price for it enters the contract at any point.

### SCALE_FACTOR

Set once in the constructor:

```
SCALE_FACTOR = 10 ** (36 + quoteTokenDecimals + quoteFeed1Decimals + quoteFeed2Decimals
                        - baseTokenDecimals  - baseFeed1Decimals  - baseFeed2Decimals)
               * quoteVaultConversionSample / baseVaultConversionSample
```

Morpho's price convention: the value of 1 collateral token in loan tokens, scaled by
`1e36 + loanDecimals - collateralDecimals`.

**Useful inversion:** when Etherscan does not decode constructor args, `SCALE_FACTOR` is a
pure function of them, so you can solve backwards for the token decimals. The adapter
should do this and surface the recovered values — it is often the only way to learn the
loan asset's decimals from the oracle alone.

### What the source tells you that the getters cannot

The NatSpec on `ChainlinkDataFeedLib.getPrice` states outright that staleness is not
checked and min/max bounds are not checked, on the assumption the feed upholds them. This
is a first-class finding for any explanation of a Morpho oracle and should be emitted by
the adapter as a standing caveat for the family, not left to the model to notice.

Also worth surfacing from the constructor NatSpec: markets should be configured so the
price cannot instantly drop below `oldPrice * LLTV * LIF`, and vaults that can receive
donations should not be used as the loan/quote asset.

---

## 5. Golden fixture

Use this as the first adapter test. Pin to a block; values below were read on Ethereum
mainnet in August 2026.

**Oracle:** `0x67BcC03438D7d71c39343d7AD21cb73Dc19aDB89`
Verified `MorphoChainlinkOracleV2`, solc 0.8.21, immutable, no owner.
Created directly by an EOA (tagged "Steakhouse PYUSD V2: Deployer"), **not** via
`MorphoChainlinkOracleV2Factory` — so factory provenance is absent and verification rests
on Etherscan's similar-match against another verified deployment.

| Getter | Value |
|---|---|
| `BASE_VAULT` | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` (Ethena sUSDe) |
| `BASE_VAULT_CONVERSION_SAMPLE` | `100000000` (1e8) |
| `BASE_FEED_1` | `0x0` |
| `BASE_FEED_2` | `0x0` |
| `QUOTE_FEED_1` | `0x0` |
| `QUOTE_FEED_2` | `0x0` |
| `QUOTE_VAULT` | `0x0` |
| `QUOTE_VAULT_CONVERSION_SAMPLE` | `1` |
| `SCALE_FACTOR` | `1e28` (29 digits) |
| `price()` | `1243004120000000000000000000000000000` (1.24300412e36) |

Derived:

```
price = SCALE_FACTOR * sUSDe.convertToAssets(1e8)
      = 1e28 * 124,300,412
      = 1.24300412e36                                  <- matches live call exactly

SCALE_FACTOR inversion:
  10^(36 + dQuote - dBase) / 1e8 = 1e28
  => 36 + dQuote - dBase = 36
  => dQuote = dBase = 18       (USDe is 18, so the loan asset is 18-decimal too)
```

Plain-English target output for this fixture: the oracle reads no external price data at
all. Every feed slot is null, so the entire price is sUSDe's own ERC4626 share-to-asset
ratio, with the loan token hardcoded at exactly 1 USDe. A USDe depeg is structurally
invisible to any market using it; LLTV headroom carries the whole peg risk. The price is
monotonically increasing under normal operation (rewards vesting), so liquidations arise
from interest accrual rather than collateral price moves — with the exception of an
Ethena loss-socialisation event, which would land in full in one block with no smoothing.
Secondary surface: `convertToAssets` derives from the vault's USDe balance minus unvested
amount, so a raw ERC-20 transfer into the sUSDe contract inflates the rate immediately;
bounded by cost at current TVL but real.

---

## 6. v1 scope

- Morpho family only
- Ethereum mainnet + Base
- Output: config table, resolved dependencies, formula, verification badge, prose
- Golden fixture above passing in CI

Then, in order: Chainlink family, Euler EVK, feed-provenance enrichment (§7).

---

## 7. Deferred enrichment

Properties that are not in the source and need extra probing:

- **Effective heartbeat** — infer from timestamps across recent rounds via `getRoundData`,
  not from anything declared on-chain.
- **Feed provenance** — is `aggregator()` an `AccessControlledOffchainAggregator` with a
  Chainlink multisig `owner()`, or an EOA-controlled push wrapper? Same ABI, entirely
  different trust assumption.
- **Deviation threshold** — off-chain metadata, needs a feed registry lookup.

---

## 8. Known limits — state these in the UI, do not paper over them

- **Unverified contracts:** no plain-English output. Report bytecode hash, creator, and
  creation tx and stop. Decompiler output is not a substitute.
- **Bespoke one-off oracles:** roughly 80% of pasted addresses will be a known family and
  will resolve cleanly; the tail is genuinely hard. For unknown families, emit the
  structured config dump and dependency resolution, clearly labelled as unverified, with
  no confident narrative.
- **Proxies:** implementation resolution must happen before classification, or the ABI
  fingerprint will match the proxy rather than the logic.
