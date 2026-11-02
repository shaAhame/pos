import { describe, it, expect } from "vitest";
import { splitSerials, addSerials, pickMessage } from "../lib/pickUnits";

const units = [
  { serial: "SC3D6103A4W6PDYNAS" },
  { serial: "SC3D6103A9G8PDYNAT" },
  { serial: "SC3D6103A9GRPDYNAA" },
];

describe("splitting what was typed or pasted", () => {
  it("handles spaces, new lines, commas and semicolons", () => {
    expect(splitSerials("A B\nC,D;E")).toEqual(["A", "B", "C", "D", "E"]);
  });
  it("ignores stray whitespace and empty input", () => {
    expect(splitSerials("  \n  ")).toEqual([]);
    expect(splitSerials(null)).toEqual([]);
    expect(splitSerials("  ONE  ")).toEqual(["ONE"]);
  });
});

describe("choosing units", () => {
  it("takes a single scan", () => {
    const r = addSerials(units, [], "SC3D6103A9G8PDYNAT");
    expect(r.chosen).toEqual(["SC3D6103A9G8PDYNAT"]);
    expect(r.added).toHaveLength(1);
  });

  // The reason this exists: pasting a column used to select nothing at all.
  it("takes a whole pasted list at once", () => {
    const r = addSerials(units, [], "SC3D6103A4W6PDYNAS SC3D6103A9G8PDYNAT\nSC3D6103A9GRPDYNAA");
    expect(r.chosen).toHaveLength(3);
    expect(r.unknown).toEqual([]);
  });

  it("matches however it was typed, and keeps the real serial", () => {
    const r = addSerials(units, [], "  sc3d6103a4w6pdynas  ");
    expect(r.chosen).toEqual(["SC3D6103A4W6PDYNAS"]);
  });

  it("names anything not in stock here instead of dropping it quietly", () => {
    const r = addSerials(units, [], "SC3D6103A4W6PDYNAS NOT-A-REAL-ONE");
    expect(r.chosen).toEqual(["SC3D6103A4W6PDYNAS"]);
    expect(r.unknown).toEqual(["NOT-A-REAL-ONE"]);
  });

  it("never counts the same unit twice", () => {
    const r = addSerials(units, ["SC3D6103A4W6PDYNAS"], "SC3D6103A4W6PDYNAS SC3D6103A4W6PDYNAS");
    expect(r.chosen).toHaveLength(1);
    expect(r.added).toEqual([]);
    expect(r.already).toHaveLength(2);
  });

  it("adds to what was already chosen", () => {
    const r = addSerials(units, ["SC3D6103A4W6PDYNAS"], "SC3D6103A9G8PDYNAT");
    expect(r.chosen).toHaveLength(2);
  });
});

describe("what the person is told", () => {
  it("confirms a clean paste", () => {
    const { ok, bad } = pickMessage(addSerials(units, [], "SC3D6103A4W6PDYNAS SC3D6103A9G8PDYNAT"));
    expect(ok).toBe("2 units chosen");
    expect(bad).toBe("");
  });

  it("lists the first few that failed, and counts the rest", () => {
    const { bad } = pickMessage(addSerials(units, [], "X1 X2 X3 X4 X5"));
    expect(bad).toContain("X1, X2, X3");
    expect(bad).toContain("and 2 more");
  });

  it("uses singular for one unit", () => {
    expect(pickMessage(addSerials(units, [], "SC3D6103A4W6PDYNAS")).ok).toBe("1 unit chosen");
  });
});
