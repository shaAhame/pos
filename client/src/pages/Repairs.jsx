import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { useForm, clean } from "../lib/form";
import { fmt } from "../lib/money";
import { uuid } from "../lib/uuid";
import { dateOnly, dateTime } from "../lib/format";
import Modal from "../components/Modal";
import MoneyIn from "../components/MoneyIn";
import { Empty, Input, Loading, Pager } from "../components/ui";
import { printNow } from "../components/Receipt";

export const JOB_STATUS = {
  received: { label: "Booked in", badge: "" },
  diagnosing: { label: "Checking", badge: "" },
  waiting_parts: { label: "Waiting for parts", badge: "saffron" },
  in_progress: { label: "Repairing", badge: "" },
  ready: { label: "Ready to collect", badge: "green" },
  collected: { label: "Collected", badge: "" },
  cancelled: { label: "Cancelled", badge: "red" },
};
const NEXT = ["received", "diagnosing", "waiting_parts", "in_progress", "ready"];
const Status = ({ s }) => <span className={`badge ${JOB_STATUS[s]?.badge || ""}`}>{JOB_STATUS[s]?.label || s}</span>;

export default function Repairs() {
  const { settings } = useSession();
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const dq = useDebounced(q, 300);
  const list = useApi("/repairs", { status, q: dq || undefined, page, limit: 30 });
  useEffect(() => { setPage(1); }, [status, dq]);
  return (
    <>
      <div className="page-head">
        <div><h1>Repairs</h1><p>Devices booked in for repair, from booking to collection.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}>Book in a repair</button>
      </div>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Status" style={{ margin: 0 }}>
          {[["open", "Not collected"], ["ready", "Ready"], ["collected", "Collected"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) =>
            <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <div className="field"><label htmlFor="rq">Search</label><input id="rq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job number, name, phone, IMEI" /></div>
      </div>
      <div className="panel">
        {list.loading && !list.data ? <Loading /> : !list.data?.jobs.length ? <Empty title="No repairs here">Use "Book in a repair" when a customer leaves a device.</Empty> : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Job</th><th>Customer</th><th>Device</th><th>Issue</th><th>Status</th><th>Promised</th><th className="num">To pay</th></tr></thead>
                <tbody>
                  {list.data.jobs.map((j) => (
                    <tr key={j._id} className="clickable" tabIndex={0} onClick={() => setOpen(j._id)} onKeyDown={(e) => e.key === "Enter" && setOpen(j._id)}>
                      <td><strong>{j.jobNumber}</strong><div className="small muted">{dateOnly(j.createdAt, settings.timezone)}</div></td>
                      <td>{j.customerName}<div className="small muted">{j.customerPhone}</div></td>
                      <td>{j.device}{j.serial && <div className="small muted">{j.serial}</div>}</td>
                      <td className="small">{j.issue}</td>
                      <td><Status s={j.status} />{j.underWarranty && <> <span className="badge green">Warranty</span></>}</td>
                      <td>{j.promisedDate ? dateOnly(j.promisedDate + "T12:00:00Z", settings.timezone) : ""}</td>
                      <td className="num">{fmt(j.totalDue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} noun="jobs" />
          </>
        )}
      </div>
      {creating && <NewJob onClose={() => setCreating(false)} onDone={(j) => { setCreating(false); list.reload(); setOpen(j._id); }} />}
      {open && <JobDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

function NewJob({ onClose, onDone }) {
  const staff = useApi("/users/staff");
  const f = useForm({ customerName: "", customerPhone: "", device: "", serial: "", issue: "", accessories: "", condition: "", estimate: "", promisedDate: "", technicianId: "" });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/repairs", clean(f.values, ["estimate"]));
      toast.success(`${data.jobNumber} booked in${data.underWarranty ? " (under warranty)" : ""}`);
      onDone(data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Book in a repair" onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <Input label="Customer name" form={f} name="customerName" required />
          <Input label="Phone" form={f} name="customerPhone" type="tel" required />
          <Input label="Device" form={f} name="device" required placeholder="e.g. Samsung Galaxy A15" />
          <Input label="Serial / IMEI" form={f} name="serial" hint="If it was bought here, warranty is checked automatically" />
          <div className="field span-all"><label htmlFor="ji">What's wrong?</label><textarea id="ji" required value={f.values.issue} onChange={(e) => f.set("issue", e.target.value)} /></div>
          <Input label="Accessories left with the device" form={f} name="accessories" placeholder="e.g. Charger, case" />
          <Input label="Condition" form={f} name="condition" placeholder="e.g. Scratch on back" />
          <Input label="Estimate" form={f} name="estimate" type="number" min="0" step="0.01" />
          <Input label="Promised by" form={f} name="promisedDate" type="date" />
          <div className="field"><label htmlFor="jt">Technician</label>
            <select id="jt" value={f.values.technicianId} onChange={(e) => f.set("technicianId", e.target.value)}>
              <option value="">Not assigned</option>{(staff.data || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select></div>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Book in</button></div>
      </form>
    </Modal>
  );
}

function JobDetail({ id, onClose, onChanged }) {
  const { settings, can } = useSession();
  const { data: j, setData } = useApi(`/repairs/${id}`);
  const staff = useApi("/users/staff");
  const [labour, setLabour] = useState("");
  const [note, setNote] = useState("");
  const [addPart, setAddPart] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [slip, setSlip] = useState(false);
  useEffect(() => { if (j) setLabour(String(j.labourCharge)); }, [j?.labourCharge]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = async (body, msg) => {
    try { const { data } = await api.put(`/repairs/${id}`, body); setData(data); onChanged(); if (msg) toast.success(msg); setNote(""); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const removePart = async (pid) => {
    try { const { data } = await api.delete(`/repairs/${id}/parts/${pid}`); setData(data); onChanged(); toast.success("Part put back in stock"); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const cancel = async () => {
    const reason = window.prompt("Why is this repair cancelled? Parts used go back to stock.");
    if (!reason?.trim()) return;
    try { const { data } = await api.post(`/repairs/${id}/cancel`, { reason }); setData(data); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const printSlip = () => { setSlip(true); printNow(); setTimeout(() => setSlip(false), 1500); };
  if (!j) return <Modal title="Repair" onClose={onClose}><Loading /></Modal>;
  const isOpen = NEXT.includes(j.status);
  return (
    <Modal title={`${j.jobNumber}: ${j.device}`} onClose={onClose} wide
      footer={<div className="actions">
        <button className="btn" onClick={printSlip}>Print job slip</button>
        {isOpen && <button className="btn danger" onClick={cancel}>Cancel repair</button>}
        {isOpen && <button className="btn primary" onClick={() => setCollecting(true)}>Customer collects</button>}
      </div>}>
      <div className="two-col">
        <div className="stack">
          <div className="row"><Status s={j.status} />{j.underWarranty && <span className="badge green">Under warranty: no charge</span>}{j.invoiceNumber && <span className="muted">Paid on {j.invoiceNumber}</span>}</div>
          <p><strong>{j.customerName}</strong>, {j.customerPhone}</p>
          <p><strong>Issue:</strong> {j.issue}</p>
          {j.serial && <p className="small">Serial / IMEI: {j.serial}</p>}
          {(j.accessories || j.condition) && <p className="small muted">{[j.accessories && `Left with: ${j.accessories}`, j.condition && `Condition: ${j.condition}`].filter(Boolean).join(". ")}</p>}
          {isOpen && (
            <>
              <div className="field"><label>Move to</label>
                <div className="chips" style={{ margin: 0 }}>{NEXT.map((s) => <button key={s} className="chip" aria-pressed={j.status === s} onClick={() => j.status !== s && update({ status: s }, JOB_STATUS[s].label)}>{JOB_STATUS[s].label}</button>)}</div></div>
              <div className="form-grid">
                <div className="field"><label htmlFor="jl">Labour charge</label>
                  <div className="row"><input id="jl" type="number" min="0" step="0.01" value={labour} onChange={(e) => setLabour(e.target.value)} style={{ width: 140 }} />
                    <button className="btn small" onClick={() => update({ labourCharge: Number(labour) || 0 }, "Charge saved")}>Save</button></div></div>
                <div className="field"><label htmlFor="jtech">Technician</label>
                  <select id="jtech" value={j.technician?._id || ""} onChange={(e) => update({ technicianId: e.target.value || null }, "Technician changed")}>
                    <option value="">Not assigned</option>{(staff.data || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                  </select></div>
              </div>
              {can("manager") && <label className="check"><input type="checkbox" checked={j.underWarranty} onChange={(e) => update({ underWarranty: e.target.checked }, e.target.checked ? "Marked as warranty repair (no charge)" : "Warranty removed")} />Warranty repair (no charge to the customer)</label>}
              <div className="field"><label htmlFor="jn">Add a note</label>
                <div className="row"><input id="jn" className="grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called customer, parts ordered" style={{ width: "auto" }} />
                  <button className="btn small" disabled={!note.trim()} onClick={() => update({ note }, "Note added")}>Add</button></div></div>
            </>
          )}
        </div>
        <div className="stack">
          <div className="panel">
            <div className="modal-head"><h3>Parts used</h3>{isOpen && <button className="btn small" onClick={() => setAddPart(true)}>Add part</button>}</div>
            {!j.parts.length ? <p className="muted pad" style={{ padding: 12 }}>No parts yet.</p> : (
              <table className="data"><tbody>{j.parts.map((p) => (
                <tr key={p._id}><td>{p.name}{p.serial && <div className="small muted">{p.serial}</div>}</td><td className="num">{p.quantity} × {fmt(p.price)}</td>
                  <td className="actions-cell">{isOpen && <button className="btn ghost small" onClick={() => removePart(p._id)}>Remove</button>}</td></tr>
              ))}</tbody></table>
            )}
            <div className="tape-sums" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="k">Labour</span><span className="v">{fmt(j.labourCharge)}</span>
              <span className="k">Parts</span><span className="v">{fmt(j.partsTotal)}</span>
              <span className="k"><strong>Customer pays</strong></span><span className="v"><strong>{fmt(j.totalDue)}</strong></span>
            </div>
          </div>
          <details open><summary>History</summary>
            <table className="data"><tbody>{j.events.map((e, k) => (
              <tr key={k}><td className="small">{dateTime(e.createdAt, settings.timezone)}</td><td className="small">{e.status ? <Status s={e.status} /> : null} {e.note}</td><td className="small muted">{e.userName}</td></tr>
            ))}</tbody></table>
          </details>
        </div>
      </div>
      {addPart && <AddPart jobId={id} onClose={() => setAddPart(false)} onDone={(d) => { setData(d); setAddPart(false); onChanged(); }} />}
      {collecting && <Collect job={j} onClose={() => setCollecting(false)} onDone={(d) => { setData(d); setCollecting(false); onChanged(); }} />}
      {slip && createPortal(<JobSlip job={j} settings={settings} />, document.getElementById("print-root"))}
    </Modal>
  );
}

function AddPart({ jobId, onClose, onDone }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const prods = useApi(dq ? "/products" : null, { filter: dq, limit: 10 });
  const [pick, setPick] = useState(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/repairs/${jobId}/parts`, { product: pick._id, quantity: Number(qty) || 1, price: price === "" ? undefined : Number(price), serial });
      toast.success(`${pick.displayName || pick.name} taken from stock`);
      onDone(data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a part from stock" onClose={onClose} labelledBy="ap-title">
      <div className="stack">
        {!pick ? (
          <>
            <div className="field"><label htmlFor="apq">Find the part</label><input id="apq" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
            {(prods.data?.products || []).map((p) => (
              <button key={p._id} className="btn" style={{ justifyContent: "space-between" }} onClick={() => { setPick(p); setPrice(String(p.price)); }}>
                <span>{p.displayName || p.name}</span><span className="muted">{p.quantity} in stock, {fmt(p.price)}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <p><strong>{pick.displayName || pick.name}</strong> <button className="btn ghost small" onClick={() => setPick(null)}>Change</button></p>
            <div className="form-grid">
              {pick.trackSerials ? <div className="field"><label htmlFor="aps">Serial of the part</label><input id="aps" value={serial} onChange={(e) => setSerial(e.target.value)} autoFocus /></div>
                : <div className="field"><label htmlFor="apn">Quantity</label><input id="apn" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></div>}
              <div className="field"><label htmlFor="app">Price to the customer (each)</label><input id="app" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            </div>
            <div className="actions"><button className="btn primary" disabled={busy || (pick.trackSerials && !serial.trim())} onClick={save}>Use part</button></div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Collect({ job, onClose, onDone }) {
  const [pay, setPay] = useState({ payments: [], valid: job.totalDue === 0 });
  const [busy, setBusy] = useState(false);
  const ref = useMemo(() => uuid(), []);
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/repairs/${job._id}/collect`, { payments: job.totalDue > 0 ? pay.payments : [], cashTendered: pay.cashTendered, clientRef: ref });
      toast.success(job.totalDue > 0 ? `Paid. Invoice ${data.invoiceNumber}` : "Collected");
      onDone(data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${job.jobNumber}: customer collects`} onClose={onClose} labelledBy="col-title">
      <div className="stack">
        {job.totalDue > 0 ? (<><p>Customer pays <strong>{fmt(job.totalDue)}</strong> (labour {fmt(job.labourCharge)} + parts {fmt(job.partsTotal)}).</p>
          <MoneyIn total={job.totalDue} onChange={setPay} idPrefix="col" /></>)
          : <p>{job.underWarranty ? "Warranty repair: nothing to pay." : "Nothing to charge."} Hand the device back to the customer.</p>}
        <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !pay.valid} onClick={save}>{job.totalDue > 0 ? "Take payment and hand over" : "Hand over"}</button></div>
      </div>
    </Modal>
  );
}

function JobSlip({ job, settings }) {
  return (
    <div className="receipt">
      <div className="c"><div className="shopname">{settings.shopName}</div>{job.location?.name && <div>{job.location.name}</div>}{settings.phone && <div>Tel: {settings.phone}</div>}</div>
      <hr />
      <div className="c" style={{ fontSize: 16, fontWeight: 700 }}>REPAIR {job.jobNumber}</div>
      <table><tbody>
        <tr><td>Date</td><td className="r">{dateTime(job.createdAt, settings.timezone)}</td></tr>
        <tr><td>Customer</td><td className="r">{job.customerName}</td></tr>
        <tr><td>Phone</td><td className="r">{job.customerPhone}</td></tr>
        <tr><td>Device</td><td className="r">{job.device}</td></tr>
        {job.serial && <tr><td>Serial</td><td className="r">{job.serial}</td></tr>}
        {job.estimate != null && <tr><td>Estimate</td><td className="r">{fmt(job.estimate)}</td></tr>}
        {job.promisedDate && <tr><td>Ready by</td><td className="r">{job.promisedDate}</td></tr>}
      </tbody></table>
      <hr />
      <div>Problem: {job.issue}</div>
      {job.accessories && <div>Left with device: {job.accessories}</div>}
      {job.condition && <div>Condition: {job.condition}</div>}
      {job.underWarranty && <div className="stamp">WARRANTY REPAIR</div>}
      <hr />
      <div className="c">Bring this slip to collect your device.</div>
    </div>
  );
}
