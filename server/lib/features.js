// Features a business can have switched on. The platform admin chooses them per business;
// the business type picks sensible defaults.
const FEATURES = {
  splitPayments:  { label: "Split payments (cash + card + bank transfer)", group: "Till" },
  lineDiscounts:  { label: "Discounts on individual items", group: "Till" },
  serials:        { label: "Serial / IMEI numbers for each unit", group: "Electronics" },
  warranty:       { label: "Warranty periods and warranty lookup", group: "Electronics" },
  variants:       { label: "Product variants (colour, storage, size)", group: "Electronics" },
  repairs:        { label: "Repairs and job cards", group: "Electronics" },
  supplierClaims: { label: "Supplier warranty claims", group: "Electronics" },
  installments:   { label: "Installments (easy payment)", group: "Payments" },
  orders:         { label: "Advance orders with deposits", group: "Payments" },
  tradeIns:       { label: "Trade-ins as part payment", group: "Payments" },
};

const PRESETS = {
  grocery:     ["splitPayments", "lineDiscounts"],
  general:     ["splitPayments", "lineDiscounts", "orders", "variants"],
  electronics: Object.keys(FEATURES),
};

// Effective features = preset for the type, overridden by anything the admin set explicitly.
const effectiveFeatures = (type, stored = {}) => {
  const out = {};
  for (const k of Object.keys(FEATURES)) out[k] = (PRESETS[type] || []).includes(k);
  for (const [k, v] of Object.entries(stored || {})) if (k in FEATURES) out[k] = !!v;
  return out;
};

module.exports = { FEATURES, PRESETS, effectiveFeatures };
