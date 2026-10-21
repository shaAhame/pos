import { useMemo, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { useForm } from "../lib/form";
import { fmt } from "../lib/money";
import { uuid } from "../lib/uuid";
import { dateOnly } from "../lib/format";
import Modal from "../components/Modal";
import MoneyIn from "../components/MoneyIn";
import { Empty, Input, Loading } from "../components/ui";
import { Receipt, PrintReceipt, printNow } from "../components/Receipt";

const ST = { open: ["Waiting for stock", "saffron"], ready: ["Ready to collect", "green"], completed: ["Collected", ""], cancelled: ["Cancelled", "red"] };

export default function Orders() {
  const { settings } = useSession();
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const dq = useDebounced(q, 300);
  const list = useApi("/orders", { status, q: dq || undefined });
  return (
    <>
      <div className="page-head">
        <div><h1>Orders</h1><p>Customer orders with a deposit, collected and paid off later.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}>New order</button>
      </div>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Show" style={{ margin: 0 }}>
          {[["open", "Not collected"], ["completed", "Collected"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) => <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <div className="field"><label htmlFor="oq">Search</label><input id="oq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, name or phone" /></div>
      </div>
      <div className="panel">
        {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty title="No orders here" /> : (
          <table className="data">
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th></tr></thead>
            <tbody>{list.data.map((o) => (
              <tr key={o._id} className="clickable" tabIndex={0} onClick={() => setOpen(o._id)} onKeyDown={(e) => e.key === "Enter" && setOpen(o._id)}>
                <td><strong>{o.orderNumber}</strong><div className="small muted">{dateOnly(o.createdAt, settings.timezone)}</div></td>
                <td>{o.customerName}<div className="small muted">{o.customerPhone}</div></td>
                <td className="small">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</td>
                <td className="num">{fmt(o.total)}</td><td className="num">{fmt(o.depositPaid)}</td>
                <td><span className={`badge ${ST[o.status][1]}`}>{ST[o.status][0]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {creating && <NewOrder onClose={() => setCreating(false)} onDone={(o) => { setCreating(false); list.reload(); setOpen(o._id); }} />}
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

function NewOrder({ onClose, onDone }) {
  const f = useForm({ customerName: "", customerPhone: "", dueDate: "", note: "", deposit: "", depositMethod: "Cash" });
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const prods = useApi(dq ? "/products" : null, { filter: dq, limit: 8 });
  const [busy, setBusy] = useState(false);
  const total = lines.reduce((t, l) => t + l.price * l.quantity, 0);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const v = f.values;
    try {
      const { data } = await api.post("/orders", {
        customerName: v.customerName, customerPhone: v.customerPhone, dueDate: v.dueDate, note: v.note,
        items: lines.map((l) => ({ product: l.product, quantity: l.quantity })),
        deposit: Number(v.deposit) > 0 ? { amount: Number(v.deposit), method: v.depositMethod } : undefined,
      });
      toast.success(`${data.orderNumber} created`); onDone(data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="New order" onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <Input label="Customer name" form={f} name="customerName" required />
          <Input label="Phone" form={f} name="customerPhone" type="tel" required />
          <Input label="Expected by" form={f} name="dueDate" type="date" />
          <Input label="Note" form={f} name="note" />
        </div>
        <div className="field"><label htmlFor="oaq">Add products</label><input id="oaq" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></div>
        {(prods.data?.products || []).map((p) => (
          <button type="button" key={p._id} className="btn" style={{ justifyContent: "space-between" }}
            onClick={() => { if (!lines.some((l) => l.product === p._id)) setLines([...lines, { product: p._id, name: p.displayName || p.name, price: p.price, quantity: 1 }]); setQ(""); }}>
            <span>{p.displayName || p.name}</span><span className="muted">{fmt(p.price)}</span></button>
        ))}
        {lines.length > 0 && (
          <table className="data"><tbody>{lines.map((l) => (
            <tr key={l.product}><td>{l.name}</td>
              <td><input type="number" min="1" value={l.quantity} aria-label={`Quantity of ${l.name}`} style={{ width: 80 }} onChange={(e) => setLines(lines.map((x) => (x.product === l.product ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} /></td>
              <td className="num">{fmt(l.price * l.quantity)}</td>
              <td><button type="button" className="btn ghost small" onClick={() => setLines(lines.filter((x) => x.product !== l.product))}>Remove</button></td></tr>
          ))}<tr><td colSpan={2}><strong>Total</strong></td><td className="num"><strong>{fmt(total)}</strong></td><td /></tr></tbody></table>
        )}
        <div className="form-grid">
          <Input label="Deposit taken now" form={f} name="deposit" type="number" min="0" step="0.01" />
          <div className="field"><label htmlFor="odm">Deposit paid by</label><select id="odm" value={f.values.depositMethod} onChange={(e) => f.set("depositMethod", e.target.value)}><option value="Cash">Cash</option><option value="Card">Card</option><option value="Bank">Bank transfer</option></select></div>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !lines.length}>Create order</button></div>
      </form>
    </Modal>
  );
}

function OrderDetail({ id, onClose, onChanged }) {
  const { settings, has } = useSession();
  const { data: o, setData } = useApi(`/orders/${id}`);
  const [completing, setCompleting] = useState(false);
  const [dep, setDep] = useState({ amount: "", method: "Cash" });
  const [sale, setSale] = useState(null);
  const act = async (fn, msg) => { try { const r = await fn(); setData({ ...o, ...r.data }); onChanged(); toast.success(msg); } catch (err) { toast.error(errorMessage(err)); } };
  if (!o) return <Modal title="Order" onClose={onClose}><Loading /></Modal>;
  const live = ["open", "ready"].includes(o.status);
  return (
    <Modal title={`${o.orderNumber}: ${o.customerName}`} onClose={onClose} wide
      footer={live && <div className="actions">
        <button className="btn danger" onClick={() => { const reason = window.prompt("Why cancel? Any deposit is given back in cash."); if (reason?.trim()) act(() => api.post(`/orders/${id}/cancel`, { reason }), "Order cancelled, deposit returned"); }}>Cancel order</button>
        {o.status === "open" && <button className="btn" onClick={() => act(() => api.post(`/orders/${id}/ready`), "Marked ready. Call the customer.")}>Mark ready</button>}
        <button className="btn primary" onClick={() => setCompleting(true)}>Customer collects</button>
      </div>}>
      <div className="two-col">
        <div className="stack">
          <p><span className={`badge ${ST[o.status][1]}`}>{ST[o.status][0]}</span> {o.customerPhone}{o.dueDate ? `. Expected ${dateOnly(o.dueDate + "T12:00:00Z", settings.timezone)}` : ""}{o.invoiceNumber ? `. Sale ${o.invoiceNumber}` : ""}</p>
          <table className="data"><tbody>{o.items.map((i) => <tr key={i._id}><td>{i.name}</td><td className="num">{i.quantity} × {fmt(i.price)}</td></tr>)}</tbody></table>
          {o.note && <p className="muted">{o.note}</p>}
        </div>
        <div className="stack">
          <div className="tape-sums panel"><span className="k">Total</span><span className="v">{fmt(o.total)}</span><span className="k">Deposit paid</span><span className="v">{fmt(o.depositPaid)}</span><span className="k"><strong>Left to pay</strong></span><span className="v"><strong>{fmt(o.balance)}</strong></span></div>
          {live && o.balance > 0 && (
            <div className="panel pad stack"><h3>Add to the deposit</h3>
              <div className="row"><input type="number" aria-label="Amount" min="0" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} style={{ width: 130 }} />
                <select aria-label="Paid by" value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })} style={{ width: "auto" }}><option value="Cash">Cash</option><option value="Card">Card</option><option value="Bank">Bank transfer</option></select>
                <button className="btn" disabled={!(Number(dep.amount) > 0)} onClick={() => act(() => api.post(`/orders/${id}/deposit`, { amount: Number(dep.amount), method: dep.method }), "Deposit added").then(() => setDep({ amount: "", method: "Cash" }))}>Add</button></div>
            </div>
          )}
        </div>
      </div>
      {completing && <CompleteOrder order={o} serialsOn={has("serials")} onClose={() => setCompleting(false)}
        onDone={(r) => { setData(r.order); setCompleting(false); setSale(r.sale); onChanged(); }} />}
      {sale && (
        <Modal title="Order collected" onClose={() => setSale(null)} footer={<div className="actions"><button className="btn" onClick={printNow}>Print receipt</button><button className="btn primary" onClick={() => setSale(null)}>Done</button></div>}>
          <Receipt sale={sale} settings={settings} /><PrintReceipt sale={sale} settings={settings} />
        </Modal>
      )}
    </Modal>
  );
}

function CompleteOrder({ order, serialsOn, onClose, onDone }) {
  const [pay, setPay] = useState({ payments: [], valid: order.balance === 0 });
  const [serials, setSerials] = useState({});
  const [busy, setBusy] = useState(false);
  const ref = useMemo(() => uuid(), []);
  const tracked = order.items.filter((i) => serialsOn && i.trackSerials);
  const serialsOk = tracked.every((i) => (serials[i._id] || []).length === i.quantity);
  const save = async () => {
    setBusy(true);
    try { const { data } = await api.post(`/orders/${order._id}/complete`, { payments: order.balance > 0 ? pay.payments : [], cashTendered: pay.cashTendered, serials, clientRef: ref }); onDone(data); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${order.orderNumber}: customer collects`} onClose={onClose} labelledBy="co-title">
      <div className="stack">
        {tracked.map((i) => (
          <div className="field" key={i._id}><label htmlFor={`cs-${i._id}`}>Serial / IMEI of each {i.name} ({(serials[i._id] || []).length} of {i.quantity})</label>
            <textarea id={`cs-${i._id}`} rows={Math.min(4, i.quantity + 1)} onChange={(e) => setSerials({ ...serials, [i._id]: e.target.value.split(/[\s,]+/).filter(Boolean) })} placeholder="Scan each unit" /></div>
        ))}
        {order.balance > 0 ? (<><p>Deposit {fmt(order.depositPaid)} already paid. Customer pays <strong>{fmt(order.balance)}</strong> now.</p><MoneyIn total={order.balance} onChange={setPay} idPrefix="oc" /></>)
          : <p>Fully paid by deposit.</p>}
        <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !pay.valid || !serialsOk} onClick={save}>Complete sale</button></div>
      </div>
    </Modal>
  );
}
