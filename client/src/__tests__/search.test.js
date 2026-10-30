import { describe, it, expect } from "vitest";
import { searchProducts, resolveScan, nameOf } from "../lib/search";

const phone = { _id: "1", name: "Nova X5 Pro", variant: "256GB Black", model: "Nova X5 Pro", category: "Phones", barcode: null };
const cable = { _id: "2", name: "USB-C Cable", category: "Accessories", barcode: "8850010000021" };
const case_ = { _id: "3", name: "Silicone Case", category: "Accessories", barcode: "8850010000045" };
const catalog = [phone, cable, case_];

describe("product names", () => {
  it("shows the variant after the name", () => {
    expect(nameOf(phone)).toBe("Nova X5 Pro 256GB Black");
    expect(nameOf(cable)).toBe("USB-C Cable");
  });
});

describe("searching", () => {
  it("matches name, variant, model and the start of a barcode", () => {
    expect(searchProducts(catalog, { term: "nova" })).toEqual([phone]);
    expect(searchProducts(catalog, { term: "256gb" })).toEqual([phone]);
    expect(searchProducts(catalog, { term: "885001000004" })).toEqual([case_]);
  });

  it("stays inside the chosen category", () => {
    expect(searchProducts(catalog, { category: "Accessories", term: "nova" })).toEqual([]);
    expect(searchProducts(catalog, { category: "Accessories" })).toEqual([cable, case_]);
  });
});

describe("pressing Enter / scanning", () => {
  it("adds the product whose barcode was scanned", () => {
    expect(resolveScan(catalog, { term: "8850010000021" })).toEqual({ action: "add", product: cable });
  });

  it("adds the product when the typed words match exactly one", () => {
    expect(resolveScan(catalog, { term: "nova" })).toEqual({ action: "add", product: phone });
  });

  // The bug this guards against: a scanner presses Enter before the on-screen list
  // catches up. Enter must judge the code itself, not whatever is showing.
  it("does not grab the only product on screen when an unknown code is scanned", () => {
    const oneProductShowing = [phone];
    const r = resolveScan(oneProductShowing, { term: "354829100000029" });
    expect(r.action).toBe("lookup");
    expect(r.matches).toBe(0);
  });

  it("does not grab the only product in a filtered category either", () => {
    const r = resolveScan(catalog, { category: "Phones", term: "354829100000029" });
    expect(r.action).toBe("lookup");
  });

  it("leaves the choice to the cashier when several products match", () => {
    expect(resolveScan(catalog, { term: "a" }).action).toBe("lookup");
    expect(resolveScan(catalog, { term: "a" }).matches).toBeGreaterThan(1);
  });

  it("does nothing on an empty box", () => {
    expect(resolveScan(catalog, { term: "   " })).toEqual({ action: "none" });
  });
});
