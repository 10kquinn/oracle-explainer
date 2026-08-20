"use client";

import { useState, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ResolvedAddr {
  address: string;
  label: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  description: string | null;
  owner: string | null;
  aggregator: string | null;
  aggregatorOwner: string | null;
  asset: string | null;
  assetSymbol: string | null;
}

interface HumanPrice {
  value: string;
  exponent: number;
  baseSymbol: string | null;
  quoteSymbol: string | null;
  usdLike: boolean;
  statement: string;
  basis: string;
}

interface FormulaExplanation {
  summary: string;
  steps: string[];
  notes: string[];
}

interface ExplanationResult {
  address: string;
  chainId: number;
  family: string;
  contractName: string;
  config: Record<string, unknown>;
  resolved: Record<string, ResolvedAddr>;
  pricingPath: {
    formula: string;
    formulaExplanation: FormulaExplanation;
    humanPrice: HumanPrice | null;
    recomputedPrice: string;
    components: {
      name: string;
      role: string;
      value: string;
      source: string;
    }[];
    caveats: string[];
    derived: Record<string, unknown>;
  } | null;
  livePrice: string | null;
  verified: boolean;
  tier: "verified-path" | "path-mismatch" | "described" | "opaque";
  explanation: FormulaExplanation;
  limitation: string | null;
  creator: { address: string; txHash: string } | null;
  underlyingOracles?: Record<string, ExplanationResult>;
}

const CHAINS = [
  { id: 1, name: "Ethereum", explorer: "https://etherscan.io" },
  { id: 8453, name: "Base", explorer: "https://basescan.org" },
];

const EXAMPLE_ADDRESS = "0x67BcC03438D7d71c39343d7AD21cb73Dc19aDB89";

const LOADING_STEPS = [
  "Resolving contract",
  "Reading oracle configuration",
  "Resolving dependencies",
  "Computing pricing path",
  "Verifying against chain",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function explorerUrl(chainId: number) {
  return CHAINS.find((c) => c.id === chainId)?.explorer ?? "https://etherscan.io";
}

function addressLink(chainId: number, addr: string) {
  return `${explorerUrl(chainId)}/address/${addr}`;
}

function txLink(chainId: number, hash: string) {
  return `${explorerUrl(chainId)}/tx/${hash}`;
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cycle through loading steps while waiting
  useEffect(() => {
    if (!loading) return;
    setLoadingStep(0);
    const interval = setInterval(() => {
      setLoadingStep((s) =>
        s < LOADING_STEPS.length - 1 ? s + 1 : s,
      );
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: address.trim(), chainId }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || `HTTP ${res.status}`);
        } else {
          setResult(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [address, chainId],
  );

  function useExample() {
    setAddress(EXAMPLE_ADDRESS);
    setChainId(1);
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header
        className="border-b px-6 py-4 flex items-center justify-between"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          <span
            className="font-mono text-sm font-medium tracking-wide"
            style={{ color: "var(--text)" }}
          >
            ORACLE EXPLAINER
          </span>
        </div>
        <span
          className="text-xs font-mono"
          style={{ color: "var(--text-tertiary)" }}
        >
          v1 — Morpho
        </span>
      </header>

      {/* Main content */}
      <main className="flex-1 w-full max-w-[900px] mx-auto px-6 py-10">
        {/* Intro */}
        <div className="mb-8">
          <h1
            className="text-lg font-medium mb-2"
            style={{ color: "var(--text)" }}
          >
            Explain an oracle
          </h1>
          <p
            className="text-sm leading-relaxed max-w-xl"
            style={{ color: "var(--text-secondary)" }}
          >
            Paste a Morpho oracle contract address to get a verified breakdown
            of how it computes its price, what it assumes, and what it
            doesn&apos;t check.
          </p>
        </div>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="mb-4">
          <div className="flex gap-2">
            <div
              className="flex-1 flex items-center border rounded-md overflow-hidden"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border-strong)",
              }}
            >
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                spellCheck={false}
                className="flex-1 bg-transparent px-4 py-2.5 font-mono text-sm outline-none placeholder:opacity-30"
                style={{ color: "var(--text)" }}
              />
            </div>
            <select
              value={chainId}
              onChange={(e) => setChainId(Number(e.target.value))}
              className="px-3 py-2.5 rounded-md border text-sm font-mono cursor-pointer outline-none"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border-strong)",
                color: "var(--text-secondary)",
              }}
            >
              {CHAINS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={loading || !address.trim()}
              className="px-5 py-2.5 rounded-md text-sm font-medium transition-opacity disabled:opacity-30"
              style={{
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              {loading ? "Analyzing..." : "Explain"}
            </button>
          </div>
        </form>

        {/* Example link */}
        {!result && !loading && (
          <button
            type="button"
            onClick={useExample}
            className="text-xs font-mono mb-10 cursor-pointer hover:underline"
            style={{ color: "var(--text-tertiary)" }}
          >
            Try example: {truncateAddress(EXAMPLE_ADDRESS)} (Morpho sUSDe oracle)
          </button>
        )}

        {/* Loading state */}
        {loading && <LoadingView step={loadingStep} />}

        {/* Error */}
        {error && <ErrorView message={error} />}

        {/* Result */}
        {result && <ResultView result={result} />}
      </main>

      {/* Footer */}
      <footer
        className="border-t px-6 py-4 text-center"
        style={{ borderColor: "var(--border)" }}
      >
        <p
          className="text-xs font-mono"
          style={{ color: "var(--text-tertiary)" }}
        >
          Every pricing path is recomputed from on-chain config and checked
          against the live contract. Nothing here is generated.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading view                                                       */
/* ------------------------------------------------------------------ */

function LoadingView({ step }: { step: number }) {
  return (
    <div
      className="rounded-lg border p-6 mt-6"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      <div className="space-y-3">
        {LOADING_STEPS.map((label, i) => {
          const isDone = i < step;
          const isCurrent = i === step;
          return (
            <div key={label} className="flex items-center gap-3">
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: isDone
                    ? "var(--verified)"
                    : isCurrent
                      ? "var(--accent)"
                      : "var(--border-strong)",
                  ...(isCurrent
                    ? { animation: "step-pulse 1.8s ease-in-out infinite" }
                    : {}),
                }}
              />
              <span
                className="text-sm font-mono"
                style={{
                  color: isDone
                    ? "var(--text-secondary)"
                    : isCurrent
                      ? "var(--text)"
                      : "var(--text-tertiary)",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Error view                                                         */
/* ------------------------------------------------------------------ */

function ErrorView({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border p-4 mt-6"
      style={{
        background: "var(--danger-dim)",
        borderColor: "rgba(248, 113, 113, 0.2)",
      }}
    >
      <p className="text-sm font-medium mb-1" style={{ color: "var(--danger)" }}>
        Analysis failed
      </p>
      <p className="text-sm font-mono" style={{ color: "var(--text-secondary)" }}>
        {message}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tier presentation                                                  */
/* ------------------------------------------------------------------ */

/**
 * What the badge claims is exactly what was established — no more. Only a
 * recomputed-and-matched pricing path earns "VERIFIED"; everything else says
 * plainly what it is instead of borrowing the same green.
 */
const TIER_STYLE: Record<
  ExplanationResult["tier"],
  { label: string; color: string; dim: string; border: string; blurb: string }
> = {
  "verified-path": {
    label: "VERIFIED",
    color: "var(--verified)",
    dim: "var(--verified-dim)",
    border: "rgba(52, 211, 153, 0.15)",
    blurb: "The pricing path was recomputed from config and matches the live call exactly.",
  },
  "path-mismatch": {
    label: "MISMATCH",
    color: "var(--danger)",
    dim: "var(--danger-dim)",
    border: "rgba(248, 113, 113, 0.15)",
    blurb: "The recomputed value disagrees with the live call, so the parse is wrong somewhere.",
  },
  described: {
    label: "DESCRIBED",
    color: "var(--accent)",
    dim: "var(--accent-dim)",
    border: "rgba(91, 141, 239, 0.2)",
    blurb: "Read off-chain but not verified — no pricing mechanism is claimed below.",
  },
  opaque: {
    label: "NO SOURCE",
    color: "var(--text-tertiary)",
    dim: "var(--surface-raised)",
    border: "var(--border)",
    blurb: "Source code is not published, so there is nothing to explain.",
  },
};

/* ------------------------------------------------------------------ */
/*  Result view                                                        */
/* ------------------------------------------------------------------ */

function ResultView({ result }: { result: ExplanationResult }) {
  const chain = CHAINS.find((c) => c.id === result.chainId);
  const tier = TIER_STYLE[result.tier] ?? TIER_STYLE.described;
  const path = result.pricingPath;

  return (
    <div className="mt-6 space-y-0">
      {/* ---- Tier + contract header ---- */}
      <div
        className="rounded-t-lg border border-b-0 p-5"
        style={{ background: tier.dim, borderColor: tier.border }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium ${
                  result.verified ? "verified-badge" : ""
                }`}
                style={{ background: tier.dim, color: tier.color }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: tier.color }}
                />
                {tier.label}
              </span>
              <span
                className="text-xs font-mono"
                style={{ color: "var(--text-secondary)" }}
              >
                {result.contractName}
              </span>
            </div>
            <a
              href={addressLink(result.chainId, result.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              {result.address}
            </a>
            <p
              className="text-xs mt-2 max-w-lg leading-relaxed"
              style={{ color: "var(--text-tertiary)" }}
            >
              {tier.blurb}
            </p>
          </div>
          <span
            className="text-xs font-mono px-2 py-0.5 rounded shrink-0"
            style={{
              background: "var(--surface)",
              color: "var(--text-tertiary)",
            }}
          >
            {chain?.name ?? `Chain ${result.chainId}`}
          </span>
        </div>
      </div>

      {/* ---- Main result panels ---- */}
      <div
        className="border rounded-b-lg overflow-hidden"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        {/* What blocked verification, when something did */}
        {result.limitation && (
          <Section title="Limitation" first>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {result.limitation}
            </p>
          </Section>
        )}

        {/* Formula — only exists when an adapter ran */}
        {path && (
          <Section
            title="Pricing formula"
            first={!result.limitation}
          >
            <pre
              className="font-mono text-sm overflow-x-auto"
              style={{ color: "var(--accent)" }}
            >
              {path.formula}
            </pre>
          </Section>
        )}

        {/* Plain English — always present, whatever the tier */}
        <Section
          title="In plain English"
          first={!result.limitation && !path}
        >
          <FormulaInPlainEnglish explanation={result.explanation} bare />
        </Section>

        {/* Verification numbers */}
        {path && result.livePrice !== null && (
          <Section title="Verification">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <PriceHeadline
                human={path.humanPrice}
                rawPrice={result.livePrice}
              />
              <span
                className="text-xs font-medium px-2 py-0.5 rounded shrink-0"
                style={{
                  background: result.verified
                    ? "var(--verified-dim)"
                    : "var(--danger-dim)",
                  color: result.verified
                    ? "var(--verified)"
                    : "var(--danger)",
                }}
              >
                {result.verified ? "Exact match" : "MISMATCH"}
              </span>
            </div>

            <div
              className="mt-4 pt-4 border-t space-y-1.5"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex flex-col sm:flex-row sm:gap-8 gap-1.5 font-mono text-xs">
                <div className="break-all">
                  <span style={{ color: "var(--text-tertiary)" }}>
                    Recomputed{" "}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {path.recomputedPrice}
                  </span>
                </div>
                <div className="break-all">
                  <span style={{ color: "var(--text-tertiary)" }}>
                    Live call{" "}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {result.livePrice}
                  </span>
                </div>
              </div>
              {path.humanPrice && (
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {path.humanPrice.basis}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* Components */}
        {path && path.components.length > 0 && (
          <Section title="Components">
            <div className="space-y-2">
              {path.components.map((c) => (
                <div
                  key={c.name}
                  className="flex items-start gap-2.5 font-mono text-xs"
                >
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 mt-px uppercase"
                    style={{
                      background:
                        c.role === "numerator"
                          ? "var(--num-dim)"
                          : "var(--den-dim)",
                      color:
                        c.role === "numerator" ? "var(--num)" : "var(--den)",
                    }}
                  >
                    {c.role === "numerator" ? "num" : "den"}
                  </span>
                  <span style={{ color: "var(--text-tertiary)" }}>{c.name}</span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {c.source}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Underlying oracles (for wrapper types like MetaOracle) */}
        {result.underlyingOracles &&
          Object.keys(result.underlyingOracles).length > 0 && (
            <Section title="Underlying oracles">
              <div className="space-y-4">
                {Object.entries(result.underlyingOracles).map(
                  ([role, oracle]) => (
                    <UnderlyingOracleCard
                      key={role}
                      role={role}
                      oracle={oracle}
                      isActive={
                        (role === "primary" &&
                          path?.derived.activeOracle === "primary") ||
                        (role === "backup" &&
                          path?.derived.activeOracle === "backup")
                      }
                    />
                  ),
                )}
              </div>
            </Section>
          )}

        {/* Configuration */}
        {Object.keys(result.config).length > 0 && (
          <Section title="Configuration">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <tbody>
                  {Object.entries(result.config).map(([key, value]) => {
                    const resolved = result.resolved[key];
                    const isAddress =
                      typeof value === "string" &&
                      value.startsWith("0x") &&
                      value.length === 42;
                    return (
                      <tr
                        key={key}
                        className="border-b"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td
                          className="py-2 pr-4 whitespace-nowrap align-top"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {key}
                        </td>
                        <td
                          className="py-2"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {isAddress ? (
                            <span className="flex items-center gap-2 flex-wrap">
                              <a
                                href={addressLink(
                                  result.chainId,
                                  String(value),
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                {truncateAddress(String(value))}
                              </a>
                              {resolved?.label && (
                                <span style={{ color: "var(--text)" }}>
                                  {resolved.label}
                                </span>
                              )}
                            </span>
                          ) : (
                            String(value)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Caveats */}
        {path && path.caveats.length > 0 && (
          <Section title="Standing caveats">
            <ul className="space-y-2">
              {path.caveats.map((c, i) => (
                <li
                  key={i}
                  className="text-xs leading-relaxed flex gap-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span
                    className="shrink-0 mt-0.5"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    &bull;
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Creator */}
        {result.creator && (
          <Section title="Deployment">
            <div
              className="font-mono text-xs flex flex-wrap gap-x-6 gap-y-1"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>
                Creator{" "}
                <a
                  href={addressLink(result.chainId, result.creator.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  style={{ color: "var(--text)" }}
                >
                  {truncateAddress(result.creator.address)}
                </a>
              </span>
              <span>
                Tx{" "}
                <a
                  href={txLink(result.chainId, result.creator.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  style={{ color: "var(--text)" }}
                >
                  {truncateAddress(result.creator.txHash)}
                </a>
              </span>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Underlying oracle card (for MetaOracle's primary/backup)           */
/* ------------------------------------------------------------------ */

function UnderlyingOracleCard({
  role,
  oracle,
  isActive,
}: {
  role: string;
  oracle: ExplanationResult;
  isActive: boolean;
}) {
  return (
    <div
      className="rounded-md border overflow-hidden"
      style={{
        borderColor: isActive
          ? "rgba(91, 141, 239, 0.3)"
          : "var(--border)",
        background: "var(--bg)",
      }}
    >
      {/* Card header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--border)",
          background: isActive ? "rgba(91, 141, 239, 0.05)" : "transparent",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="text-xs font-mono font-medium uppercase px-1.5 py-0.5 rounded"
            style={{
              background: isActive
                ? "var(--accent-dim)"
                : "var(--surface-raised)",
              color: isActive ? "var(--accent)" : "var(--text-tertiary)",
            }}
          >
            {role}
            {isActive ? " (active)" : ""}
          </span>
          <span
            className="text-xs font-mono"
            style={{ color: "var(--text-secondary)" }}
          >
            {oracle.contractName}
          </span>
          {oracle.verified && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: "var(--verified-dim)",
                color: "var(--verified)",
              }}
            >
              VERIFIED
            </span>
          )}
        </div>
        <a
          href={addressLink(oracle.chainId, oracle.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono hover:underline"
          style={{ color: "var(--text-tertiary)" }}
        >
          {truncateAddress(oracle.address)}
        </a>
      </div>

      {/* Formula */}
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div
          className="text-[10px] font-mono uppercase tracking-wider mb-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          Pricing formula
        </div>
        <pre
          className="font-mono text-xs overflow-x-auto"
          style={{ color: "var(--accent)" }}
        >
          {oracle.pricingPath?.formula ?? "no pricing path computed"}
        </pre>
        {oracle.pricingPath?.humanPrice && (
          <div
            className="text-xs font-mono mt-2"
            style={{ color: "var(--text-secondary)" }}
          >
            {oracle.pricingPath.humanPrice.statement}
          </div>
        )}
        <FormulaInPlainEnglish explanation={oracle.explanation} compact />
      </div>

      {/* Components */}
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div
          className="text-[10px] font-mono uppercase tracking-wider mb-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          Components
        </div>
        <div className="space-y-1.5">
          {(oracle.pricingPath?.components ?? []).map((c) => (
            <div
              key={c.name}
              className="flex items-start gap-2 font-mono text-[11px]"
            >
              <span
                className="px-1 py-0.5 rounded text-[9px] font-medium shrink-0 mt-px uppercase"
                style={{
                  background:
                    c.role === "numerator"
                      ? "var(--num-dim)"
                      : "var(--den-dim)",
                  color:
                    c.role === "numerator" ? "var(--num)" : "var(--den)",
                }}
              >
                {c.role === "numerator" ? "num" : "den"}
              </span>
              <span style={{ color: "var(--text-tertiary)" }}>{c.name}</span>
              <span style={{ color: "var(--text-secondary)" }}>{c.source}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Config table */}
      <div className="px-4 py-3">
        <div
          className="text-[10px] font-mono uppercase tracking-wider mb-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          Configuration
        </div>
        <table className="w-full text-[11px] font-mono">
          <tbody>
            {Object.entries(oracle.config).map(([key, value]) => {
              const resolved = oracle.resolved[key];
              const isAddr =
                typeof value === "string" &&
                value.startsWith("0x") &&
                value.length === 42;
              return (
                <tr
                  key={key}
                  className="border-b"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td
                    className="py-1.5 pr-3 whitespace-nowrap align-top"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {key}
                  </td>
                  <td
                    className="py-1.5"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {isAddr ? (
                      <span className="flex items-center gap-2 flex-wrap">
                        <a
                          href={addressLink(oracle.chainId, String(value))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {truncateAddress(String(value))}
                        </a>
                        {resolved?.label && (
                          <span style={{ color: "var(--text)" }}>
                            {resolved.label}
                          </span>
                        )}
                      </span>
                    ) : (
                      String(value)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Human-readable price headline                                      */
/* ------------------------------------------------------------------ */

function PriceHeadline({
  human,
  rawPrice,
}: {
  human: HumanPrice | null;
  rawPrice: string;
}) {
  if (!human) {
    return (
      <div>
        <div
          className="text-[10px] font-mono uppercase tracking-wider mb-1.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Current price
        </div>
        <div
          className="font-mono text-sm break-all"
          style={{ color: "var(--text)" }}
        >
          {rawPrice}
        </div>
        <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
          The scaling exponent could not be recovered from SCALE_FACTOR, so no
          decimal price is shown rather than a guessed one.
        </p>
      </div>
    );
  }

  const display = human.usdLike
    ? `$${human.value}`
    : `${human.value}${human.quoteSymbol ? ` ${human.quoteSymbol}` : ""}`;

  return (
    <div>
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-1.5"
        style={{ color: "var(--text-tertiary)" }}
      >
        Current price
      </div>
      <div
        className="font-mono text-2xl leading-none tracking-tight"
        style={{ color: "var(--text)" }}
      >
        {display}
      </div>
      <div
        className="text-xs font-mono mt-2"
        style={{ color: "var(--text-secondary)" }}
      >
        {human.baseSymbol ? `1 ${human.baseSymbol}` : "1 collateral token"}
        {" = "}
        {human.value} {human.quoteSymbol ?? "loan tokens"}
      </div>
      {/* The point of this caption is that a dollar sign does not mean dollars.
          When the quote unit IS "USD" — a Chainlink USD feed — there is no gap
          to explain, and the sentence contradicts itself. */}
      {human.usdLike &&
        human.quoteSymbol &&
        human.quoteSymbol.toUpperCase() !== "USD" && (
          <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            Denominated in the loan asset ({human.quoteSymbol}), not in USD.
          </div>
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plain-English formula walkthrough                                  */
/* ------------------------------------------------------------------ */

function FormulaInPlainEnglish({
  explanation,
  compact,
  bare,
}: {
  explanation: FormulaExplanation;
  compact?: boolean;
  /** Rendered inside a Section that already supplies the heading and rule. */
  bare?: boolean;
}) {
  const bodySize = compact ? "text-[11px]" : "text-sm";
  const numSize = compact ? "text-[9px]" : "text-[10px]";

  return (
    <div
      className={bare ? "" : "mt-4 pt-4 border-t"}
      style={bare ? undefined : { borderColor: "var(--border)" }}
    >
      {!bare && (
        <div
          className={`${numSize} font-mono uppercase tracking-wider mb-2.5`}
          style={{ color: "var(--text-tertiary)" }}
        >
          In plain English
        </div>
      )}

      <p
        className={`${bodySize} leading-relaxed mb-3`}
        style={{ color: "var(--text)" }}
      >
        {explanation.summary}
      </p>

      <ol className="space-y-2.5">
        {explanation.steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              className={`${numSize} font-mono shrink-0 rounded w-5 h-5 flex items-center justify-center mt-px`}
              style={{
                background: "var(--accent-dim)",
                color: "var(--accent)",
              }}
            >
              {i + 1}
            </span>
            <span
              className={`${bodySize} leading-relaxed`}
              style={{ color: "var(--text-secondary)" }}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>

      {explanation.notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {explanation.notes.map((note, i) => (
            <li
              key={i}
              className={`${bodySize} leading-relaxed flex gap-2`}
              style={{ color: "var(--text-secondary)" }}
            >
              <span
                className="shrink-0 mt-0.5"
                style={{ color: "var(--text-tertiary)" }}
              >
                &bull;
              </span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

function Section({
  title,
  first,
  children,
}: {
  title: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={first ? "" : "border-t"}
      style={{ borderColor: "var(--border)" }}
    >
      <div className="px-5 py-4">
        <h3
          className="text-xs font-mono font-medium uppercase tracking-wider mb-3"
          style={{ color: "var(--text-tertiary)" }}
        >
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}
