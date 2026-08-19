/**
 * The rescaling arithmetic behind the displayed price.
 * Pure integer math — a rounding slip here would silently misreport a price,
 * so the edge cases are pinned.
 */

import { describe, it, expect } from "vitest";
import { scaleDown, buildHumanPrice, isUsdLike, shortNumber } from "../format";

describe("scaleDown", () => {
  it("rescales the golden fixture price", () => {
    expect(scaleDown(1243004120000000000000000000000000000n, 36)).toBe(
      "1.24300412",
    );
  });

  it("drops trailing zeros but keeps the integer part", () => {
    expect(scaleDown(2000000000000000000n, 18)).toBe("2");
    expect(scaleDown(2500000000000000000n, 18)).toBe("2.5");
  });

  it("keeps leading zeros on sub-1 values, counting significance after them", () => {
    expect(scaleDown(12345678901230n, 18)).toBe("0.000012345678");
  });

  it("truncates rather than rounds, so every digit shown is real", () => {
    expect(scaleDown(1999999999999999999n, 18)).toBe("1.99999999");
  });

  it("handles a zero fractional part and a zero price", () => {
    expect(scaleDown(0n, 36)).toBe("0");
    expect(scaleDown(10n ** 36n, 36)).toBe("1");
  });

  it("handles a negative exponent by multiplying up", () => {
    expect(scaleDown(5n, -3)).toBe("5000");
  });
});

describe("buildHumanPrice", () => {
  it("marks USD-denominated loan assets and prefixes a dollar figure", () => {
    const h = buildHumanPrice({
      raw: 1243004120000000000000000000000000000n,
      exponent: 36,
      baseSymbol: "sUSDe",
      quoteSymbol: "USDe",
      basis: "test",
    });
    expect(h.usdLike).toBe(true);
    expect(h.statement).toBe("1 sUSDe = 1.24300412 USDe (≈ $1.24300412)");
  });

  it("does not claim a dollar figure for a non-USD loan asset", () => {
    const h = buildHumanPrice({
      raw: 1200000000000000000000000000000000000n,
      exponent: 36,
      baseSymbol: "wstETH",
      quoteSymbol: "WETH",
      basis: "test",
    });
    expect(h.usdLike).toBe(false);
    expect(h.statement).toBe("1 wstETH = 1.2 WETH");
  });

  it("falls back to a generic unit when the loan asset cannot be named", () => {
    const h = buildHumanPrice({
      raw: 10n ** 36n,
      exponent: 36,
      baseSymbol: "XYZ",
      quoteSymbol: null,
      basis: "test",
    });
    expect(h.statement).toBe("1 XYZ = 1 loan tokens");
  });
});

describe("shortNumber", () => {
  it("shortens clean powers of ten and leaves everything else exact", () => {
    expect(shortNumber(100000000n)).toBe("1e8");
    expect(shortNumber(10n ** 28n)).toBe("1e28");
    expect(shortNumber(1n)).toBe("1");
    expect(shortNumber(1000n)).toBe("1000");
    expect(shortNumber(123456789n)).toBe("123456789");
  });
});

describe("isUsdLike", () => {
  it("is case-insensitive and rejects unknown symbols", () => {
    expect(isUsdLike("usdc")).toBe(true);
    expect(isUsdLike("WETH")).toBe(false);
    expect(isUsdLike(null)).toBe(false);
  });
});
