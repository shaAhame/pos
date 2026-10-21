import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { fmt, money, round2 } from "../lib/money";
import { dateTime, fullName, todayISO, addDays } from "../lib/format";
import { getQueue, getFailed, dismissFailed, subscribe } from "../lib/offline";
import Modal from "../components/Modal";
import { Empty, Loading, Pager } from "../components/ui";
import { Receipt, PrintReceipt, printNow } from "../components/Receipt";

const statusBadge = (s) => {
  if (s.paymentStatus === "Voided") return <span className="badge red">Voided</span>;
  if (s.returnStatus === "Returned") return <span className="badge saffron">Returned</span>;
  if (s.returnStatus === "Partially returned") return <span className="badge saffron">Part returned</span>;
  return <span className="badge green">Paid</span>;
};

export default function Sales() {
  const { settings, can, user, multiBranch, location } = useSession();
  const branchCol = multiBranch && user.role === "owner" && !location;
  const tz = settings.timezone;
  const [params, setParams] = useSearchParams();
  const { id } = useParams();
  const nav = useNavigate();
  const shiftId = params.get("shiftId") || undefined;
  const [from, setFrom] = useState(shiftId ? "" : addDays(todayISO(tz), -6));
  const [to, setTo] = useState(shiftId ? "" : todayISO(tz));
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const list = useApi("/sales", {
    from: from || undefined, to: to || undefined, q: dq || undefined, status, page, limit: 25, shiftId,
    offline: offlineOnly ? true : undefined,
  });
  useEffect(() => { setPage(1); }, [from, to, dq, status, offlineOnly, shiftId]);

  const [queue, setQueue] = useState(getQueue());
  const [failed, setFailed] = useState(getFailed());
  useEffect(() => subscribe(() => { setQueue(getQueue()); setFailed(getFailed()); }), []);
  const myQueue = queue.filter((e) => e.userId === user._id);

  return (
    <>
      <div className="page-head">
        <div><h1>Sales</h1><p>{can("manager") ? "All sales. Open one to reprint, void or return items." : "Your sales. Open one to reprint the receipt."}</p></div>
      </div>

      {myQueue.length > 0 && (
        <div className="notice">
          <span><strong>{myQueue.length} sale{myQueue.length > 1 ? "s" : ""} saved on this till</strong> are waiting to upload. They'll go up automatically when the connection is back.</span>
        </div>
      )}
      {can("manager") && failed.length > 0 && (
        <div className="panel pad stack" style={{ marginBottom: 16, borderColor: "#EBC3BF" }}>
          <h3>Offline sales the server refused</h3>
          <p className="muted small">These were sold while offline but couldn't be recorded. Check each one, enter it again on the till if needed, then dismiss it.</p>
          {failed.map((f) => (
            <div key={f.clientRef} className="row between" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 8 }}>
              <span>{dateTime(f.queuedAt, tz)}: {f.receipt?.items?.map((i) => `${i.name} ×${i.quantity}`).join(", ")} ({money(f.receipt?.totalAmount, settings.currency)})<br /><span className="small danger-text">{f.error}</span></span>
              <button className="btn small" onClick={() => { if (window.confirm("Dismiss this offline sale?")) dismissFailed(f.clientRef); }}>Dismiss</button>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <div className="field"><label htmlFor="q">Search</label><input id="q" type="search" placeholder="Invoice number or customer" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="from">From</label><input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="field"><label htmlFor="status">Status</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option><option value="Paid">Paid</option><option value="Voided">Voided</option>
          </select>
        </div>
        {can("manager") && <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={offlineOnly} onChange={(e) => setOfflineOnly(e.target.checked)} />Offline sales only</label>}
        {shiftId && <button className="btn" onClick={() => { params.delete("shiftId"); setParams(params); setFrom(addDays(todayISO(tz), -6)); setTo(todayISO(tz)); }}>Showing one shift (show all)</button>}
      </div>

      <div className="panel">
        {list.loading && !list.data ? <Loading /> : list.error ? <Empty title="Couldn't load sales">{list.error}</Empty> : !list.data.sales.length ? (
          <Empty title="No sales found">Try a wider date range.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th>Status</th>{branchCol && <th>Branch</th>}{can("manager") && <th>Cashier</th>}<th className="num">Total</th></tr></thead>
                <tbody>
                  {list.data.sales.map((s) => (
                    <tr key={s._id} className={`clickable${s.paymentStatus === "Voided" ? " voided" : ""}`} tabIndex={0}
                      onClick={() => nav(`/sales/${s._id}${shiftId ? `?shiftId=${shiftId}` : ""}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/sales/${s._id}`)}>
                      <td><strong>{s.invoiceNumber}</strong>{s.offline && <> <span className={`badge ${s.offlineNote ? "saffron" : ""}`} title={s.offlineNote || "Recorded offline"}>Offline{s.offlineNote ? ": check" : ""}</span></>}</td>
                      <td>{dateTime(s.date, tz)}</td>
                      <td>{s.customerName}</td>
                      <td className="small">{s.items.slice(0, 3).map((i) => `${i.name} ×${i.quantity}`).join(", ")}{s.items.length > 3 ? ` +${s.items.length - 3} more` : ""}</td>
                      <td>{s.paymentMethod}</td>
                      <td>{statusBadge(s)}</td>
                      {branchCol && <td>{s.location?.name}</td>}
                      {can("manager") && <td>{fullName(s.cashier)}</td>}
                      <td className="num"><strong>{fmt(s.totalAmount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} noun="sales" />
          </>
        )}
      </div>
      {id && <SaleDetail id={id} onClose={() => nav(`/sales${shiftId ? `?shiftId=${shiftId}` : ""}`)} onChanged={list.reload} />}
    </>
  );
}

function SaleDetail({ id, onClose, onChanged }) {
  const { settings, can } = useSession();
  const { data: sale, error, setData } = useApi(`/sales/${id}`);
  const [mode, setMode] = useState(null); // "void" | "return"
  const updated = (s) => { setData(s); setMode(null); onChanged(); };

  return (
    <Modal title={sale ? `Sale ${sale.invoiceNumber}` : "Sale"} onClose={onClose} wide
      footer={sale && (
        <div className="actions">
          {can("manager") && sale.paymentStatus !== "Voided" && sale.returnStatus !== "Returned" && <button className="btn" onClick={() => setMode("return")}>Return items</button>}
          {can("manager") && sale.paymentStatus !== "Voided" && !sale.returns?.length && <button className="btn danger" onClick={() => setMode("void")}>Void sale</button>}
          <button className="btn primary" onClick={printNow}>Print receipt</button>
        </div>
      )}>
      {error ? <Empty title="Couldn't load this sale">{error}</Empty> : !sale ? <Loading /> : (
        <div className="two-col">
          <div style={{ border: "1px solid var(--line)", borderRadius: 8 }}><Receipt sale={sale} settings={settings} /></div>
          <div className="stack">
            <div className="row">{statusBadge(sale)}{sale.offline && <span className="badge">Recorded offline</span>}</div>
            {sale.offlineNote && <div className="notice"><span><strong>Check this offline sale:</strong> {sale.offlineNote}</span></div>}
            {sale.voided && <p><strong>Voided</strong> by {sale.voided.byName} on {dateTime(sale.voided.at, settings.timezone)}: {sale.voided.reason}</p>}
            {sale.returns?.length > 0 && (
              <div className="stack">
                <h3>Returns</h3>
                {sale.returns.map((r) => (
                  <div key={r._id} className="panel pad small">
                    <div className="row between"><strong>{r.returnNumber}</strong><span>{money(r.refundAmount, settings.currency)} by {r.refundMethod}</span></div>
                    <div className="muted">{dateTime(r.createdAt, settings.timezone)} by {r.userName}: {r.reason}</div>
                    <div>{r.items.map((i) => `${i.name} ×${i.quantity}${i.restocked ? "" : " (not restocked)"}`).join(", ")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {sale && <PrintReceipt sale={sale} settings={settings} />}
      {mode === "void" && <VoidModal sale={sale} onClose={() => setMode(null)} onDone={updated} />}
      {mode === "return" && <ReturnModal sale={sale} onClose={() => setMode(null)} onDone={updated} />}
    </Modal>
  );
}

function VoidModal({ sale, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post(`/sales/${sale._id}/void`, { reason });
      toast.success(`${sale.invoiceNumber} voided. Stock put back.`);
      onDone(data.sale);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Void ${sale.invoiceNumber}`} onClose={onClose} labelledBy="void-title">
      <form className="stack" onSubmit={submit}>
        <p>Voiding cancels the whole sale and puts the items back in stock. Use it for mistakes made during this shift. For goods brought back later, use <strong>Return items</strong>.</p>
        <div className="field"><label htmlFor="vr">Reason</label><input id="vr" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scanned twice by mistake" autoFocus /></div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Keep sale</button><button className="btn danger solid" disabled={busy || !reason.trim()}>Void sale</button></div>
      </form>
    </Modal>
  );
}

function ReturnModal({ sale, onClose, onDone }) {
  const { settings } = useSession();
  const [qty, setQty] = useState({});
  const [restock, setRestock] = useState({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(sale.paymentMethod);
  const [busy, setBusy] = useState(false);
  const unit = (i) => i.price * (1 - sale.discount / 100) * (1 + sale.taxRate / 100);
  const estimate = round2(sale.items.reduce((t, i) => t + round2(unit(i) * (Number(qty[i._id]) || 0)), 0));
  const chosen = sale.items.filter((i) => Number(qty[i._id]) > 0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post(`/sales/${sale._id}/returns`, {
        reason, refundMethod: method,
        items: chosen.map((i) => ({ saleItemId: i._id, quantity: Number(qty[i._id]), restock: restock[i._id] !== false })),
      });
      toast.success(`${data.returnNumber}: refund ${money(data.refundAmount, settings.currency)} by ${method}`);
      onDone(data.sale);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Return items from ${sale.invoiceNumber}`} onClose={onClose} wide labelledBy="ret-title">
      <form className="stack" onSubmit={submit}>
        <table className="data">
          <thead><tr><th>Item</th><th className="num">Bought</th><th className="num">Already returned</th><th>Return now</th><th>Back on shelf?</th></tr></thead>
          <tbody>
            {sale.items.map((i) => {
              const left = i.quantity - i.returnedQuantity;
              return (
                <tr key={i._id}>
                  <td>{i.name}</td><td className="num">{i.quantity}</td><td className="num">{i.returnedQuantity}</td>
                  <td><input type="number" min="0" max={left} disabled={!left} value={qty[i._id] ?? ""} placeholder="0" style={{ width: 90 }}
                    aria-label={`Return quantity for ${i.name}`}
                    onChange={(e) => setQty({ ...qty, [i._id]: Math.min(left, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} /></td>
                  <td><label className="check"><input type="checkbox" checked={restock[i._id] !== false} disabled={!left}
                    onChange={(e) => setRestock({ ...restock, [i._id]: e.target.checked })} />{restock[i._id] === false ? "No, damaged" : "Yes"}</label></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="form-grid">
          <div className="field"><label htmlFor="rr">Reason</label><input id="rr" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Expired, wrong size" /></div>
          <div className="field"><label htmlFor="rm">Refund by</label>
            <select id="rm" value={method} onChange={(e) => setMethod(e.target.value)}><option>Cash</option><option>Card</option></select>
          </div>
        </div>
        <div className="row between">
          <span>Refund about <strong>{money(estimate, settings.currency)}</strong> <span className="muted small">(includes this sale's discount and tax)</span></span>
          <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !chosen.length || !reason.trim()}>Record return and refund</button></div>
        </div>
      </form>
    </Modal>
  );
}
