// Finding products at the till.
//
// The product list on screen updates a moment after each keystroke, so that typing stays
// smooth. A barcode scanner, though, types the whole code and presses Enter instantly -
// faster than that pause. So Enter must never use the list on screen: it searches the
// catalogue itself, with exactly what is in the box right now.
export const nameOf = (p) => p.displayName || (p.variant ? `${p.name} ${p.variant}` : p.name);

export function searchProducts(catalog, { category = "", term = "" } = {}) {
  let list = category ? catalog.filter((p) => p.category === category) : catalog;
  const q = term.trim().toLowerCase();
  if (q) {
    list = list.filter((p) =>
      nameOf(p).toLowerCase().includes(q) ||
      (p.model || "").toLowerCase().includes(q) ||
      (p.barcode || "").toLowerCase().startsWith(q));
  }
  return list;
}

// What pressing Enter in the search box should do.
//   { action: "add", product }   - one clear match, put it in the sale
//   { action: "lookup" }         - no match here; it may be a serial / IMEI, ask the server
//   { action: "none" }           - several matches: the cashier picks one by tapping
export function resolveScan(catalog, { category = "", term = "" } = {}) {
  const code = term.trim();
  if (!code) return { action: "none" };

  const barcode = catalog.find((p) => p.barcode && p.barcode === code);
  if (barcode) return { action: "add", product: barcode };

  const matches = searchProducts(catalog, { category, term: code });
  if (matches.length === 1) return { action: "add", product: matches[0] };
  return { action: "lookup", matches: matches.length };
}
