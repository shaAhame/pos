import { useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { fmt } from "../lib/money";
import { dateOnly } from "../lib/format";
import Modal from "../components/Modal";
import { Empty, Loading } from "../components/ui";

const OUTCOME = { sent: ["With supplier", "saffron"], repaired: ["Repaired", "green"], replaced: ["Replaced", "green"], credited: ["Credited", "green"], rejected: ["Rejected", "red"] };

export default function Claims() {
  const { settings } = useSession();
  const [status, setStatus] = useState("open");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const list = useApi("/claims", { status });
  return (
    <>
      <div className="page-head">
        <div><h1>Supplier claims</h1><p>Faulty goods sent back to suppliers under warranty, and what came back.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}>New claim</button>
      </div>
      <div className="chips" role="group" aria-label="Status">
        {[["open", "With supplier"], ["all", "All"]].map(([k, l]) => <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      <div className="panel">
        {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty title="No claims" /> : (
          <table className="data">
            <thead><tr><th>Claim</th><th>Supplier</th><th>Items</th><th>Sent</th><th>Status</th></tr></thead>
            <tbody>{list.data.map((c) => (
              <tr key={c._id} className="clickable" tabIndex={0} onClick={() => setOpen(c)} onKeyDown={(e) => e.key === "Enter" && setOpen(c)}>
                <td><strong>{c.claimNumber}</strong></td><td>{c.supplier.company}</td>
                <td className="small">{c.items.map((i) => `${i.name}${i.serial ? ` (${i.serial})` : ` ×${i.quantity}`}`).join(", ")}</td>
                <td>{dateOnly(c.createdAt, settings.timezone)}</td>
                <td><span className={`badge ${OUTCOME[c.status][1]}`}>{OUTCOME[c.status][0]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {creating && <NewClaim onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} />}
      {open && <ClaimDetail claim={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function NewClaim({ onClose, onDone }) {
  const sups = useApi("/suppliers", { limit: 500 });
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const prods = useApi(dq ? "/products" : null, { filter: dq, limit: 8 });
  const [busy, setBusy] = useState(false);
  const add = (p) => { setLines([...lines, { key: Math.random(), product: p._id, name: p.displayName || p.name, tracked: p.trackSerials, quantity: 1, serial: "", fromStock: true }]); setQ(""); };
  const set = (k, patch) => setLines(lines.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/claims", { supplierId, reason, items: lines.map((l) => ({ product: l.product, quantity: l.tracked ? 1 : Number(l.quantity) || 1, serial: l.serial, fromStock: l.fromStock })) });
      toast.success("Claim created"); onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="New supplier claim" onClose={onClose} wide>
      <div className="stack">
        <div className="form-grid">
          <div className="field"><label htmlFor="cs">Supplier</label>
            <select id="cs" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Choose</option>{(sups.data?.suppliers || []).map((s) => <option key={s._id} value={s._id}>{s.company} ({s.name})</option>)}</select></div>
          <div className="field"><label htmlFor="cr">Reason</label><input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dead on arrival" /></div>
        </div>
        <div className="field"><label htmlFor="cq">Add a product</label><input id="cq" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {(prods.data?.products || []).map((p) => <button key={p._id} className="btn" style={{ justifyContent: "flex-start" }} onClick={() => add(p)}>{p.displayName || p.name}</button>)}
        {lines.length > 0 && (
          <table className="data">
            <thead><tr><th>Product</th><th>Serial / quantity</th><th>Where is it now?</th><th></th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key}><td>{l.name}</td>
                <td>{l.tracked ? <input aria-label={`Serial of ${l.name}`} value={l.serial} onChange={(e) => set(l.key, { serial: e.target.value })} placeholder="Serial / IMEI" />
                  : <input type="number" min="1" aria-label={`Quantity of ${l.name}`} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} style={{ width: 90 }} />}</td>
                <td><select aria-label="Where is it now" value={l.fromStock ? "shelf" : "faulty"} onChange={(e) => set(l.key, { fromStock: e.target.value === "shelf" })}>
                  <option value="shelf">On the shelf (take it out of stock)</option><option value="faulty">Already set aside as faulty</option></select></td>
                <td><button className="btn ghost small" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remove</button></td></tr>
            ))}</tbody>
          </table>
        )}
        <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !supplierId || !reason.trim() || !lines.length} onClick={save}>Send claim</button></div>
      </div>
    </Modal>
  );
}

function ClaimDetail({ claim, onClose, onDone }) {
  const { settings } = useSession();
  const [outcome, setOutcome] = useState("repaired");
  const [repl, setRepl] = useState({});
  const [credit, setCredit] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const resolve = async () => {
    setBusy(true);
    try {
      await api.post(`/claims/${claim._id}/resolve`, { outcome, replacementSerials: repl, creditAmount: credit === "" ? null : Number(credit), note });
      toast.success("Claim updated"); onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${claim.claimNumber}: ${claim.supplier.company}`} onClose={onClose} wide>
      <div className="stack">
        <p>{claim.reason}. Sent {dateOnly(claim.createdAt, settings.timezone)} by {claim.createdBy}.</p>
        <table className="data"><tbody>{claim.items.map((i) => (
          <tr key={i._id}><td>{i.name}</td><td>{i.serial || `×${i.quantity}`}</td><td>{i.replacementSerial ? `Replaced by ${i.replacementSerial}` : ""}</td></tr>
        ))}</tbody></table>
        {claim.status !== "sent" ? <p>Outcome: <strong>{OUTCOME[claim.status][0]}</strong>{claim.creditAmount ? `, credit ${fmt(claim.creditAmount)}` : ""}{claim.resolutionNote ? `. ${claim.resolutionNote}` : ""}</p> : (
          <div className="panel pad stack">
            <h3>What did the supplier do?</h3>
            <div className="chips" style={{ margin: 0 }}>
              {[["repaired", "Repaired it (back on the shelf)"], ["replaced", "Replaced it"], ["credited", "Gave credit"], ["rejected", "Rejected the claim"]].map(([k, l]) =>
                <button key={k} className="chip" aria-pressed={outcome === k} onClick={() => setOutcome(k)}>{l}</button>)}
            </div>
            {outcome === "replaced" && claim.items.filter((i) => i.serial).map((i) => (
              <div className="field" key={i._id}><label htmlFor={`r-${i._id}`}>New serial for {i.name} (was {i.serial})</label>
                <input id={`r-${i._id}`} value={repl[i._id] || ""} onChange={(e) => setRepl({ ...repl, [i._id]: e.target.value })} /></div>
            ))}
            {outcome === "credited" && <div className="field"><label htmlFor="cc">Credit amount</label><input id="cc" type="number" min="0" value={credit} onChange={(e) => setCredit(e.target.value)} /></div>}
            <div className="field"><label htmlFor="cn">Note</label><input id="cn" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="actions"><button className="btn primary" disabled={busy} onClick={resolve}>Save outcome</button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
