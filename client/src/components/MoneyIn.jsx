// Small "take payment" block (cash / card / bank transfer) for repairs, orders and installments.
import { useEffect, useState } from "react";
import { fmt, round2 } from "../lib/money";
import { useSession } from "../lib/session";

export default function MoneyIn({ total, onChange, idPrefix = "mi" }) {
  const { has } = useSession();
  const split = has("splitPayments");
  const [amounts, setAmounts] = useState({ Cash: total, Card: 0, Bank: 0 });
  const [method, setMethod] = useState("Cash");
  const [given, setGiven] = useState("");
  useEffect(() => { setAmounts({ Cash: total, Card: 0, Bank: 0 }); }, [total]);
  const payments = (split
    ? ["Cash", "Card", "Bank"].map((m) => ({ method: m, amount: round2(Number(amounts[m]) || 0) }))
    : [{ method, amount: round2(total) }]).filter((p) => p.amount > 0);
  const paid = round2(payments.reduce((t, p) => t + p.amount, 0));
  const cash = payments.filter((p) => p.method === "Cash").reduce((t, p) => t + p.amount, 0);
  const change = given === "" ? null : round2(Number(given) - cash);
  const valid = Math.abs(paid - total) < 0.005 && (change === null || change >= 0);
  useEffect(() => { onChange({ payments, cashTendered: cash > 0 && given !== "" ? Number(given) : null, valid }); },
    [JSON.stringify(payments), given, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      {split ? (
        <div className="pay-rows">
          {["Cash", "Card", "Bank"].map((m) => (
            <div className="field" key={m}><label htmlFor={`${idPrefix}-${m}`}>{m === "Bank" ? "Bank transfer" : m}</label>
              <input id={`${idPrefix}-${m}`} type="number" min="0" step="0.01" value={amounts[m] || ""} placeholder="0.00" onChange={(e) => setAmounts({ ...amounts, [m]: e.target.value })} /></div>
          ))}
        </div>
      ) : (
        <div className="seg three" role="group" aria-label="Payment method">
          {["Cash", "Card", "Bank"].map((m) => <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}>{m === "Bank" ? "Bank transfer" : m}</button>)}
        </div>
      )}
      {cash > 0 && (
        <div className="field"><label htmlFor={`${idPrefix}-given`}>Cash received (optional)</label>
          <input id={`${idPrefix}-given`} type="number" min="0" step="0.01" value={given} placeholder={fmt(cash)} onChange={(e) => setGiven(e.target.value)} />
          {change !== null && <span className={change < 0 ? "danger-text" : "hint"}>{change < 0 ? `${fmt(-change)} short` : `Change: ${fmt(change)}`}</span>}</div>
      )}
      {Math.abs(paid - total) >= 0.005 && <span className="danger-text small">Payments add up to {fmt(paid)}; {fmt(total)} is due.</span>}
    </div>
  );
}
