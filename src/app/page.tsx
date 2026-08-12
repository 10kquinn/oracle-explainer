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
    recomputedPrice: string;
    components: {
      name: string;
      role: string;
      value: string;
      source: string;
    }[];
    caveats: string[];
    derived: Record<string, unknown>;
  };
  livePrice: string;
  verified: boolean;
  creator: { address: string; txHash: string } | null;
  prose: string | null;
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
  "Generating explanation",
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
          Adapters compute pricing paths deterministically. The LLM only writes
          prose.
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
/*  Result view                                                        */
/* ------------------------------------------------------------------ */

function ResultView({ result }: { result: ExplanationResult }) {
  const chain = CHAINS.find((c) => c.id === result.chainId);

  return (
    <div className="mt-6 space-y-0">
      {/* ---- Verification + contract header ---- */}
      <div
        className="rounded-t-lg border border-b-0 p-5"
        style={{
          background: result.verified
            ? "var(--verified-dim)"
            : "var(--danger-dim)",
          borderColor: result.verified
            ? "rgba(52, 211, 153, 0.15)"
            : "rgba(248, 113, 113, 0.15)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium ${
                  result.verified ? "verified-badge" : ""
                }`}
                style={{
                  background: result.verified
                    ? "rgba(52, 211, 153, 0.15)"
                    : "rgba(248, 113, 113, 0.15)",
                  color: result.verified
                    ? "var(--verified)"
                    : "var(--danger)",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: result.verified
                      ? "var(--verified)"
                      : "var(--danger)",
                  }}
                />
                {result.verified ? "VERIFIED" : "UNVERIFIED"}
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
        {/* Prose explanation — the most important output, shown first */}
        {result.prose && result.verified && (
          <Section title="Explanation" first>
            <div
              className="text-sm leading-[1.7] whitespace-pre-wrap"
              style={{ color: "var(--text)" }}
            >
              {result.prose}
            </div>
          </Section>
        )}

        {/* Unverified warning instead of prose */}
        {!result.verified && (
          <Section title="Verification failed" first>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              The recomputed price does not match the live on-chain call.
              The configuration and resolved dependencies are shown below for
              manual inspection, but no narrative explanation is provided for
              unverified pricing paths.
            </p>
          </Section>
        )}

        {/* Formula */}
        <Section title="Pricing formula">
          <pre
            className="font-mono text-sm overflow-x-auto"
            style={{ color: "var(--accent)" }}
          >
            {result.pricingPath.formula}
          </pre>
        </Section>

        {/* Verification numbers */}
        <Section title="Verification">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8 font-mono text-sm">
            <div>
              <span style={{ color: "var(--text-tertiary)" }}>Recomputed </span>
              <span style={{ color: "var(--text)" }}>
                {result.pricingPath.recomputedPrice}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-tertiary)" }}>Live call </span>
              <span style={{ color: "var(--text)" }}>
                {result.livePrice}
              </span>
            </div>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded self-start"
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
        </Section>

        {/* Components */}
        <Section title="Components">
          <div className="space-y-2">
            {result.pricingPath.components.map((c) => (
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
                      c.role === "numerator"
                        ? "var(--num)"
                        : "var(--den)",
                  }}
                >
                  {c.role === "numerator" ? "num" : "den"}
                </span>
                <span style={{ color: "var(--text-tertiary)" }}>
                  {c.name}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {c.source}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Configuration */}
        <Section title="Configuration">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <tbody>
                {Object.entries(result.config).map(([key, value]) => {
                  const resolved = result.resolved[key];
                  const isAddress =
                    typeof value === "string" && value.startsWith("0x") && value.length === 42;
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
                      <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                        {isAddress ? (
                          <span className="flex items-center gap-2 flex-wrap">
                            <a
                              href={addressLink(result.chainId, String(value))}
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

        {/* Caveats */}
        <Section title="Standing caveats">
          <ul className="space-y-2">
            {result.pricingPath.caveats.map((c, i) => (
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
