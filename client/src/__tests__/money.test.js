import { describe, expect, test } from "vitest";
import { computeTotals, quickCash, round2 } from "../lib/money";

describe("computeTotals (must match the server)", () => {
  test("same numbers as the server test case", () => {
    const t = computeTotals([{ price: 250.5, quantity: 3 }, { price: 180, quantity: 1 }], 5, 5);
    expect(t).toEqual({ subtotal: 931.5, discountAmount: 46.58, taxAmount: 44.25, totalAmount: 929.17 });
  });
  test("no discount or tax", () => {
    expect(computeTotals([{ price: 0.1, quantity: 3 }]).totalAmount).toBe(0.3);
  });
  test("item discounts come off the line before the sale discount and tax", () => {
    // same as the server: 2 x 500 with 50 off = 950, then 10% off and 10% tax
    expect(computeTotals([{ price: 500, quantity: 2, discount: 50 }], 10, 10)).toEqual({ subtotal: 950, discountAmount: 95, taxAmount: 85.5, totalAmount: 940.5 });
  });
  test("empty cart", () => {
    expect(computeTotals([]).totalAmount).toBe(0);
  });
  test("round2 handles float noise", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(247.995)).toBe(248);
  });
});

describe("quickCash", () => {
  test("offers exact amount and round notes above it", () => {
    expect(quickCash(929.17)).toEqual([929.17, 1000, 5000]);
    expect(quickCash(120)).toEqual([120, 200, 500, 1000]);
  });
});
