import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { addSerials, splitSerials, pickMessage } from "../lib/pickUnits";
import { dateTime } from "../lib/format";
import Modal from "../components/Modal";
import { Empty, Loading, Pager } from "../components/ui";

const STATUS = {
  in_transit: <span className="badge saffron">On the way</span>,
  received: <span className="badge green">Received</span>,
  cancelled: <span className="badge">Cancelled</span>,
};

export default function Transfers() {
  const { settings, can } = useSession();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const list = useApi("/transfers", { status, page, limit: 25 });
  useEffect(() => { setPage(1); }, [status]);
  return (
    <>
      <div className="page-head">
        <div><h1>Transfers</h1><p>Moving stock between branches. Stock leaves when sent and arrives when the receiving branch confirms it.</p></div>
        {can("owner") && <button className="btn primary" onClick={() => setCreating(true)}>New transfer</button>}
      </div>
      <div className="chips" role="group" aria-label="Status">
        {[["all", "All"], ["in_transit", "On the way"], ["received", "Received"], ["cancelled", "Cancelled"]].map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      <div className="panel">
        {list.loading && !list.data ? <Loading /> : !list.data?.transfers.length ? (
          <Empty title="No transfers yet">{can("owner") ? "Use New transfer to send stock to a branch." : "Transfers to or from your branch will show here."}</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Transfer</th><th>From</th><th>To</th><th>Sent</th><th className="num">Units</th><th>Status</th></tr></thead>
                <tbody>
                  {list.data.transfers.map((t) => (
                    <tr key={t._id} className="clickable" tabIndex={0} onClick={() => setOpen(t)} onKeyDown={(e) => e.key === "Enter" && setOpen(t)}>
                      <td><strong>{t.transferNumber}</strong>{t.note && <div className="small muted">{t.note}</div>}</td>
                      <td>{t.from.name}</td>
                      <td>{t.to.name}</td>
                      <td>{dateTime(t.createdAt, settings.timezone)}</td>
                      <td className="num">{t.totalSent}{t.totalReceived != null && t.totalReceived !== t.totalSent && <span className="danger-text"> ({t.totalReceived} arrived)</span>}</td>
                      <td>{STATUS[t.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} noun="transfers" />
          </>
        )}
      </div>
      {creating && <NewTransfer onClose={() => setCreating(false)} onDone={(t) => { setCreating(false); list.reload(); setOpen(t); }} />}
      {open && <TransferDetail id={open._id} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

function NewTransfer({ onClose, onDone }) {
  const { activeLocations, locationId, has } = useSession();
  const [pickFor, setPickFor] = useState(null);
  const warehouse = activeLocations.find((l) => l.type === "warehouse");
  const [from, setFrom] = useState(locationId || warehouse?._id || activeLocations[0]?._id || "");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState([]); // { product, name, quantity, available }
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q, 200);
  const stock = useApi(from ? "/products" : null, { locationId: from, limit: 5000, status: "active" });
  const available = useMemo(() => new Map((stock.data?.products || []).map((p) => [p._id, p])), [stock.data]);
  const matches = useMemo(() => {
    if (!dq) return [];
    const s = dq.toLowerCase();
    return (stock.data?.products || []).filter((p) => p.name.toLowerCase().includes(s) || (p.barcode || "") === dq).slice(0, 8);
  }, [dq, stock.data]);
  useEffect(() => { setLines([]); }, [from]);

  const add = (p) => {
    if (lines.some((l) => l.product === p._id)) return toast.info(`${p.name} is already in the list`);
    if (p.quantity <= 0) return toast.warn(`${p.name}: none in stock at this branch`);
    const tracked = has("serials") && p.trackSerials;
    setLines([...lines, { product: p._id, name: p.displayName || p.name, quantity: tracked ? 0 : 1, serials: [], tracked }]);
    setQ("");
    if (tracked) setPickFor(p._id);
  };
  const invalid = lines.some((l) => !(l.quantity >= 1) || l.quantity > (available.get(l.product)?.quantity || 0));
  const setSerials = (pid, serials) => setLines((ls) => ls.map((l) => (l.product === pid ? { ...l, serials, quantity: serials.length } : l)));

  const send = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/transfers", { fromLocationId: from, toLocationId: to, note, items: lines.map((l) => ({ product: l.product, quantity: Number(l.quantity), serials: l.serials })) });
      toast.success(`${data.transferNumber} sent. ${data.totalSent} units are on the way.`);
      onDone(data);
    } catch (err) { toast.error(errorMessage(err)); stock.reload(); } finally { setBusy(false); }
  };

  return (
    <Modal title="New transfer" onClose={onClose} wide>
      <div className="stack">
        <div className="form-grid">
          <div className="field"><label htmlFor="tf">From</label>
            <select id="tf" value={from} onChange={(e) => setFrom(e.target.value)}>
              {activeLocations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="tt">To</label>
            <select id="tt" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose a branch</option>
              {activeLocations.filter((l) => l._id !== from).map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{ position: "relative" }}>
          <label htmlFor="tq">Add products</label>
          <input id="tq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or scan a barcode" autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); add(matches[0]); } }} />
          {matches.length > 0 && (
            <div className="panel" style={{ marginTop: 4 }}>
              <table className="data"><tbody>
                {matches.map((p) => (
                  <tr key={p._id} className="clickable" onClick={() => add(p)}><td>{p.displayName || p.name}</td><td className="num muted">{p.quantity} at this branch</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
        {lines.length > 0 ? (
          <table className="data">
            <thead><tr><th>Product</th><th className="num">Available</th><th>Send</th><th></th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const avail = available.get(l.product)?.quantity || 0;
                return (
                  <tr key={l.product}>
                    <td>{l.name}</td>
                    <td className="num">{avail}</td>
                    <td>{l.tracked ? (
                      <><button className="btn small" onClick={() => setPickFor(l.product)}>{l.serials.length ? `${l.serials.length} units chosen` : "Choose units"}</button>
                        {l.serials.length > 0 && <div className="small muted">{l.serials.join(", ")}</div>}</>
                    ) : (
                      <><input type="number" min="1" max={avail} value={l.quantity} style={{ width: 100 }} aria-label={`Quantity of ${l.name}`}
                        onChange={(e) => setLines(lines.map((x) => (x.product === l.product ? { ...x, quantity: Math.floor(Number(e.target.value)) || "" } : x)))} />
                        {l.quantity > avail && <div className="small danger-text">Only {avail} available</div>}</>
                    )}</td>
                    <td className="actions-cell"><button className="btn ghost small" onClick={() => setLines(lines.filter((x) => x.product !== l.product))}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="muted">No products added yet.</p>}
        <div className="field"><label htmlFor="tn">Note (optional)</label><input id="tn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Weekly top-up, driver Sunil" /></div>
        <div className="row between">
          <span className="muted small">Stock leaves {activeLocations.find((l) => l._id === from)?.name || "the branch"} as soon as you send.</span>
          <div className="row"><button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !to || !lines.length || invalid} onClick={send}>Send transfer</button></div>
        </div>
      </div>
      {pickFor && <UnitChooser productId={pickFor} locationId={from} initial={lines.find((l) => l.product === pickFor)?.serials || []}
        onClose={() => setPickFor(null)} onDone={(serials) => { setSerials(pickFor, serials); setPickFor(null); }} />}
    </Modal>
  );
}

// Tick the units (serial / IMEI) to send from a branch.
function UnitChooser({ productId, locationId, initial, onClose, onDone }) {
  const { data } = useApi(`/products/${productId}/serials`, { locationId });
  const [chosen, setChosen] = useState(initial);
  const [scan, setScan] = useState("");
  const toggle = (s) => setChosen((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));

  // Accepts one scan or a whole pasted column.
  const take = (text) => {
    if (!splitSerials(text).length) return;
    const r = addSerials(data || [], chosen, text);
    setChosen(r.chosen);
    const { ok, bad } = pickMessage(r);
    if (ok) toast.success(ok);
    if (bad) toast.error(bad);
    setScan("");
  };
  const onScan = (e) => { if (e.key === "Enter") { e.preventDefault(); take(scan); } };
  const onPaste = (e) => {
    const text = e.clipboardData.getData("text");
    if (splitSerials(text).length > 1) { e.preventDefault(); take(text); }   // a list, not a single scan
  };

  const all = (data || []).map((u) => u.serial);
  return (
    <Modal title="Choose units to send" onClose={onClose} labelledBy="uc-title"
      footer={<div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onDone(chosen)}>Use {chosen.length} {chosen.length === 1 ? "unit" : "units"}</button></div>}>
      <div className="stack">
        <div className="field">
          <label htmlFor="uc-scan">Scan a unit, or paste a list of serials</label>
          <input id="uc-scan" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScan} onPaste={onPaste} autoFocus autoComplete="off" />
          <span className="hint">One at a time, or paste many at once separated by spaces, commas or new lines.</span>
        </div>
        {!data ? <Loading /> : !data.length ? <p className="muted">No units in stock at this branch.</p> : (
          <>
            <div className="row between">
              <span className="small muted">{chosen.length} of {all.length} chosen</span>
              <span className="row">
                <button type="button" className="btn small" onClick={() => setChosen(all)} disabled={chosen.length === all.length}>Choose all {all.length}</button>
                <button type="button" className="btn small" onClick={() => setChosen([])} disabled={!chosen.length}>Clear</button>
              </span>
            </div>
            <div className="serial-grid">{data.map((u) => <button key={u._id} type="button" className="chip" aria-pressed={chosen.includes(u.serial)} onClick={() => toggle(u.serial)}>{u.serial}</button>)}</div>
          </>
        )}
      </div>
    </Modal>
  );
}

function TransferDetail({ id, onClose, onChanged }) {
  const { settings, user, can } = useSession();
  const { data: t, setData } = useApi(`/transfers/${id}`);
  const [got, setGot] = useState({});
  const [missing, setMissing] = useState({}); // itemId -> [serial]
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canReceive = t && t.status === "in_transit" && (user.role === "owner" || user.locationId === t.to._id);

  const receive = async () => {
    setBusy(true);
    try {
      const items = t.items.map((i) => (i.serials?.length
        ? { itemId: i._id, missingSerials: missing[i._id] || [] }
        : { itemId: i._id, quantityReceived: got[i._id] === undefined || got[i._id] === "" ? i.quantitySent : Number(got[i._id]) }));
      const { data } = await api.post(`/transfers/${t._id}/receive`, { items, note });
      setData(data); onChanged();
      toast.success(data.totalReceived === data.totalSent ? `${data.transferNumber} received in full` : `${data.transferNumber} received with ${data.totalSent - data.totalReceived} missing`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const cancel = async () => {
    const reason = window.prompt("Why cancel this transfer? The stock goes back to where it came from.");
    if (!reason?.trim()) return;
    try { const { data } = await api.post(`/transfers/${t._id}/cancel`, { reason }); setData(data); onChanged(); toast.success("Transfer cancelled. Stock is back."); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <Modal title={t ? `${t.transferNumber}: ${t.from.name} to ${t.to.name}` : "Transfer"} onClose={onClose} wide
      footer={t && t.status === "in_transit" && (
        <div className="actions">
          {can("owner") && <button className="btn danger" onClick={cancel}>Cancel transfer</button>}
          {canReceive && <button className="btn primary" disabled={busy} onClick={receive}>Confirm received</button>}
        </div>
      )}>
      {!t ? <Loading /> : (
        <div className="stack">
          <div className="row">{STATUS[t.status]}<span className="muted">Sent {dateTime(t.createdAt, settings.timezone)} by {t.createdBy}</span></div>
          {t.note && <p><strong>Note:</strong> {t.note}</p>}
          {canReceive && <div className="notice green">Count what actually arrived. Change a number only if something is missing or damaged.</div>}
          <table className="data">
            <thead><tr><th>Product</th><th className="num">Sent</th><th className={canReceive ? "" : "num"}>Arrived</th></tr></thead>
            <tbody>
              {t.items.map((i) => (
                <tr key={i._id}>
                  <td>{i.name}{i.serials?.length > 0 && !canReceive && <div className="small muted">{i.serials.map((z) => z.serial + (z.received === false ? " (missing)" : "")).join(", ")}</div>}</td>
                  <td className="num">{i.quantitySent}</td>
                  {canReceive && i.serials?.length ? (
                    <td>{i.serials.map((z) => {
                      const miss = (missing[i._id] || []).includes(z.serial);
                      return (
                        <label key={z.serial} className="check small">
                          <input type="checkbox" checked={!miss} onChange={(e) => setMissing({ ...missing, [i._id]: e.target.checked ? (missing[i._id] || []).filter((x) => x !== z.serial) : [...(missing[i._id] || []), z.serial] })} />
                          {z.serial}{miss && <span className="danger-text"> missing</span>}
                        </label>
                      );
                    })}</td>
                  ) : canReceive ? (
                    <td><input type="number" min="0" max={i.quantitySent} style={{ width: 100 }} aria-label={`Arrived quantity of ${i.name}`}
                      value={got[i._id] ?? i.quantitySent} onChange={(e) => setGot({ ...got, [i._id]: e.target.value })} /></td>
                  ) : (
                    <td className="num">{i.quantityReceived == null ? "" : i.quantityReceived < i.quantitySent ? <span className="danger-text">{i.quantityReceived}</span> : i.quantityReceived}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {canReceive && <div className="field"><label htmlFor="rn">Note (optional)</label><input id="rn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. One bag torn" /></div>}
          {t.receivedAt && <p>Received {dateTime(t.receivedAt, settings.timezone)} by {t.receivedBy}{t.receiveNote ? `. ${t.receiveNote}` : ""}</p>}
          {t.cancelledAt && <p>Cancelled {dateTime(t.cancelledAt, settings.timezone)} by {t.cancelledBy}: {t.receiveNote}</p>}
        </div>
      )}
    </Modal>
  );
}
