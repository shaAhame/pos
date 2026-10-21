import { useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { fmt, money } from "../lib/money";
import { dateOnly, dateTime } from "../lib/format";
import Modal from "../components/Modal";
import { Empty, Loading } from "../components/ui";

const d = (iso, tz) => (iso ? dateOnly(iso + "T12:00:00Z", tz) : "");

export default function Installments() {
  const { settings } = useSession();
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const dq = useDebounced(q, 300);
  const list = useApi("/installments", { status, q: dq || undefined });
  return (
    <>
      <div className="page-head"><div><h1>Installments</h1><p>Easy-payment plans: what each customer still owes, and what's due or late.</p></div></div>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Show" style={{ margin: 0 }}>
          {[["active", "Active"], ["overdue", "Late"], ["due_soon", "Due this week"], ["completed", "Paid off"], ["all", "All"]].map(([k, l]) =>
            <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <div className="field"><label htmlFor="iq">Search</label><input id="iq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Plan, invoice, name or phone" /></div>
      </div>
      {list.data && (
        <div className="kpis">
          <div className="kpi"><div className="k">Still owed ({settings.currency})</div><div className="v">{fmt(list.data.totals.outstanding)}</div><div className="s">{list.data.plans.length} plans shown</div></div>
          <div className="kpi"><div className="k">Late ({settings.currency})</div><div className="v">{fmt(list.data.totals.overdue)}</div></div>
        </div>
      )}
      <div className="panel">
        {list.loading && !list.data ? <Loading /> : !list.data?.plans.length ? <Empty title="No plans here">Installment sales are made at the till ("Pay the rest in installments").</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Plan</th><th>Customer</th><th className="num">Owed</th><th>Next payment</th><th>Late</th><th>Status</th></tr></thead>
              <tbody>{list.data.plans.map((p) => (
                <tr key={p._id} className="clickable" tabIndex={0} onClick={() => setOpen(p._id)} onKeyDown={(e) => e.key === "Enter" && setOpen(p._id)}>
                  <td><strong>{p.planNumber}</strong><div className="small muted">{p.invoiceNumber}</div></td>
                  <td>{p.customer.name}<div className="small muted">{p.customer.phone}</div></td>
                  <td className="num">{fmt(p.outstanding)}</td>
                  <td>{p.nextDueDate ? `${fmt(p.nextDueAmount)} on ${d(p.nextDueDate, settings.timezone)}` : ""}</td>
                  <td>{p.overdueAmount > 0 ? <span className="badge red">{fmt(p.overdueAmount)} ({p.overdueCount})</span> : ""}</td>
                  <td>{p.status === "active" ? <span className="badge green">Active</span> : <span className="badge">{p.status === "completed" ? "Paid off" : "Cancelled"}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {open && <PlanDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

function PlanDetail({ id, onClose, onChanged }) {
  const { settings } = useSession();
  const { data: p, reload } = useApi(`/installments/${id}`);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [busy, setBusy] = useState(false);
  const pay = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post(`/installments/${id}/pay`, { amount: Number(amount), method });
      toast.success(data.message); setAmount(""); reload(); onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  if (!p) return <Modal title="Plan" onClose={onClose}><Loading /></Modal>;
  const tz = settings.timezone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  return (
    <Modal title={`${p.planNumber}: ${p.customer.name}`} onClose={onClose} wide>
      <div className="two-col">
        <div className="stack">
          <p>{p.invoiceNumber}: sale {money(p.saleTotal, settings.currency)}, down payment {fmt(p.downPayment)}{p.fee > 0 ? `, fee ${fmt(p.fee)}` : ""}. {p.months} months from {d(p.firstDue, tz)}.</p>
          <table className="data">
            <thead><tr><th>#</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th></th></tr></thead>
            <tbody>{p.dues.map((x) => (
              <tr key={x._id}><td>{x.seq}</td><td>{d(x.dueDate, tz)}</td><td className="num">{fmt(x.amount)}</td><td className="num">{fmt(x.paid)}</td>
                <td>{x.paid >= x.amount ? <span className="badge green">Paid</span> : x.dueDate < today ? <span className="badge red">Late</span> : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="stack">
          <div className="change-box"><span>Still owed</span><span className="amount">{fmt(p.outstanding)}</span></div>
          {p.status === "active" && (
            <form className="panel pad stack" onSubmit={pay}>
              <h3>Take a payment</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="pa">Amount</label><input id="pa" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={p.nextDueAmount ? fmt(p.nextDueAmount) : ""} autoFocus /></div>
                <div className="field"><label htmlFor="pm">Paid by</label><select id="pm" value={method} onChange={(e) => setMethod(e.target.value)}><option value="Cash">Cash</option><option value="Card">Card</option><option value="Bank">Bank transfer</option></select></div>
              </div>
              <div className="row">{p.nextDueAmount && <button type="button" className="btn small" onClick={() => setAmount(String(p.nextDueAmount))}>Next payment ({fmt(p.nextDueAmount)})</button>}
                <button type="button" className="btn small" onClick={() => setAmount(String(p.outstanding))}>Pay off ({fmt(p.outstanding)})</button></div>
              <button className="btn primary" disabled={busy || !(Number(amount) > 0)}>Record payment</button>
            </form>
          )}
          {p.payments.length > 0 && (
            <details open><summary>Payments received</summary>
              <table className="data"><tbody>{p.payments.map((x, k) => <tr key={k}><td className="small">{dateTime(x.createdAt, tz)}</td><td>{x.kind === "sale" ? `Down payment (${x.method})` : x.method}</td><td className="num">{fmt(x.amount)}</td><td className="small muted">{x.userName}</td></tr>)}</tbody></table>
            </details>
          )}
        </div>
      </div>
    </Modal>
  );
}
