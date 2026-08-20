/**
 * Etherscan failure classification.
 *
 * A throttled explorer and a contract with no published source are completely
 * different findings, but Etherscan reports the first as an ordinary
 * `status: "0"` body with the reason in prose — so the distinction rests
 * entirely on string matching, which is exactly the kind of thing that rots.
 */

import { describe, it, expect } from "vitest";
import {
  isRateLimited,
  EtherscanUnavailableError,
  ContractNotVerifiedError,
} from "../etherscan";

describe("isRateLimited", () => {
  it("recognises the message Etherscan actually sends", () => {
    // Observed verbatim in production when the recursive path fanned out.
    expect(isRateLimited("NOTOK", "Max calls per sec rate limit reached")).toBe(
      true,
    );
  });

  it("recognises the common phrasings regardless of case", () => {
    expect(isRateLimited("Rate limit exceeded", null)).toBe(true);
    expect(isRateLimited("NOTOK", "Too Many Requests")).toBe(true);
    expect(isRateLimited("", "MAX CALLS PER SEC")).toBe(true);
  });

  it("does not treat an unverified contract as a rate limit", () => {
    expect(isRateLimited("NOTOK", "Contract source code not verified")).toBe(
      false,
    );
    expect(isRateLimited("NOTOK", "Invalid address format")).toBe(false);
  });
});

describe("failure types", () => {
  it("marks explorer trouble transient and missing source permanent", () => {
    // The pipeline branches on exactly this to decide whether the opaque tier
    // is warranted, so the flags are load-bearing rather than decorative.
    expect(new EtherscanUnavailableError("throttled").transient).toBe(true);
    expect(new ContractNotVerifiedError("no source").transient).toBe(false);
  });

  it("keeps both catchable as Error", () => {
    expect(new EtherscanUnavailableError("x")).toBeInstanceOf(Error);
    expect(new ContractNotVerifiedError("x")).toBeInstanceOf(Error);
  });
});
