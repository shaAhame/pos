// Must match server/lib/sales.js so the till screen and the receipt always agree.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const computeTotals = (lines, discountPct = 0, taxPct = 0) => {
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.price * l.quantity), 0));
  const discountAmount = round2((subtotal * discountPct) / 100);
  const taxAmount = round2(((subtotal - discountAmount) * taxPct) / 100);
  const totalAmount = round2(subtotal - discountAmount + taxAmount);
  return { subtotal, discountAmount, taxAmount, totalAmount };
};

const nf = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (n) => nf.format(Number(n || 0));
export const money = (n, currency = "Rs.") => `${currency} ${fmt(n)}`;

// Suggested cash amounts a customer is likely to hand over.
export const quickCash = (total) => {
  const t = Math.ceil(total);
  const opts = new Set([round2(total)]);
  for (const step of [100, 500, 1000, 5000]) {
    const v = Math.ceil(t / step) * step;
    if (v >= total) opts.add(v);
  }
  return [...opts].sort((a, b) => a - b).slice(0, 4);
};
