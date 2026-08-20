/**
 * Etherscan v2 multichain API client.
 * Single API key works across all chains via the v2 endpoint.
 */

const BASE_URL = "https://api.etherscan.io/v2/api";

/**
 * A contract with no published source is a finding; a throttled explorer is a
 * traffic problem. Reporting the second as the first tells a reviewer that a
 * perfectly ordinary verified contract is opaque, which is worse than saying
 * nothing — so the two are distinct error types all the way up.
 */
export class EtherscanUnavailableError extends Error {
  readonly transient = true;
  constructor(message: string) {
    super(message);
    this.name = "EtherscanUnavailableError";
  }
}

export class ContractNotVerifiedError extends Error {
  readonly transient = false;
  constructor(message: string) {
    super(message);
    this.name = "ContractNotVerifiedError";
  }
}

/**
 * Etherscan's free tier allows 5 requests/second. Nothing in this codebase
 * calls it once: dependency resolution fans out, and a MetaOracle recurses
 * into both underlying oracles via Promise.all — so the tool rate-limits
 * itself before any other user does. Every call goes through one promise chain
 * spaced by MIN_INTERVAL_MS, which caps the whole process below the limit
 * regardless of how many callers run concurrently.
 */
const MIN_INTERVAL_MS = 220;
let queue: Promise<unknown> = Promise.resolve();

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  // Advance the chain on a timer, and swallow rejections so one failed call
  // does not poison every request queued behind it.
  queue = result.then(
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS)),
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS)),
  );
  return result;
}

const MAX_ATTEMPTS = 4;

/** Exported for tests — Etherscan signals throttling in prose, not status codes. */
export function isRateLimited(message: string, result: unknown): boolean {
  const haystack = `${message} ${typeof result === "string" ? result : ""}`.toLowerCase();
  return (
    haystack.includes("rate limit") ||
    haystack.includes("max calls per sec") ||
    haystack.includes("too many requests")
  );
}

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

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outcome = await throttle(async () => {
      const res = await fetch(url.toString());

      if (res.status === 429 || res.status >= 500) {
        return { retry: true as const, reason: `Etherscan HTTP ${res.status}` };
      }
      if (!res.ok) {
        throw new EtherscanUnavailableError(`Etherscan HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        status: string;
        result: unknown;
        message: string;
      };

      if (json.status !== "1") {
        if (isRateLimited(json.message, json.result)) {
          return { retry: true as const, reason: json.message };
        }
        // A real API-level rejection — a bad address, an unsupported chain.
        // Not retryable, and not a claim about the contract's source.
        throw new EtherscanUnavailableError(
          `Etherscan error: ${json.message} — ${JSON.stringify(json.result)}`,
        );
      }

      return { retry: false as const, value: json.result };
    });

    if (!outcome.retry) return outcome.value;

    lastError = outcome.reason;
    if (attempt < MAX_ATTEMPTS) {
      // Back off before the next attempt. The throttle already spaces calls,
      // so this only needs to cover a burst that outran the limiter.
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  throw new EtherscanUnavailableError(
    `Etherscan is rate-limiting requests (${lastError}). This is transient — retry shortly.`,
  );
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
    throw new ContractNotVerifiedError(
      `Contract source code is not published for ${address}`,
    );
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
