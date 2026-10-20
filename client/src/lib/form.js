import { useState } from "react";

export function useForm(initial) {
  const [values, setValues] = useState(initial);
  return {
    values,
    set: (k, v) => setValues((s) => ({ ...s, [k]: v })),
    reset: (v = initial) => setValues(v),
  };
}

// Drop empty strings so optional fields aren't sent; convert numeric strings.
export const clean = (values, numeric = []) => {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (numeric.includes(k)) out[k] = v === "" || v === null ? null : Number(v);
    else out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
};
