// Turning typed or pasted serial numbers into a set of units to send.
//
// Staff scan one at a time, but when a whole delivery moves branch they paste a
// column straight out of the supplier's list. Both must work, and anything that
// isn't in stock at this branch has to be named rather than silently dropped.
export const splitSerials = (text) =>
  String(text || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

const norm = (s) => String(s).trim().toUpperCase();

// units:   [{ serial }]  the ones in stock at this branch
// chosen:  serials already ticked
// returns { chosen, added, already, unknown }
export function addSerials(units, chosen, text) {
  const inStock = new Map((units || []).map((u) => [norm(u.serial), u.serial]));
  const picked = new Set(chosen);
  const added = [], already = [], unknown = [];

  for (const raw of splitSerials(text)) {
    const real = inStock.get(norm(raw));
    if (!real) { if (!unknown.includes(raw)) unknown.push(raw); continue; }
    if (picked.has(real)) { already.push(real); continue; }
    picked.add(real);
    added.push(real);
  }
  return { chosen: [...picked], added, already, unknown };
}

// What to tell the person after a paste: short, and specific about what went wrong.
export function pickMessage({ added, already, unknown }) {
  const parts = [];
  if (added.length) parts.push(`${added.length} unit${added.length === 1 ? "" : "s"} chosen`);
  if (already.length) parts.push(`${already.length} already chosen`);
  const ok = parts.join(", ");
  if (!unknown.length) return { ok, bad: "" };
  const show = unknown.slice(0, 3).join(", ");
  const more = unknown.length > 3 ? ` and ${unknown.length - 3} more` : "";
  return { ok, bad: `Not in stock at this branch: ${show}${more}` };
}
