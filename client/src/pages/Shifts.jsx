import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi } from "../lib/hooks";
import { fmt, money } from "../lib/money";
import { dateTime } from "../lib/format";
import Modal from "../components/Modal";
import { Empty, Loading, Pager } from "../components/ui";

export function OpenShiftForm({ onOpened }) {
  const { setShift, settings } = useSession();
  const [float, setFloat] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/shifts/open", { openingFloat: Number(float) || 0 });
      setShift(data);
      toast.success("Shift opened");
      onOpened?.(data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <h2>Open shift</h2>
      <div className="field">
        <label htmlFor="float">Cash in the drawer now ({settings.currency})</label>
        <input id="float" type="number" min="0" step="0.01" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0.00" autoFocus />
        <span className="hint">Count the starting cash (float) before the first sale.</span>
      </div>
      <button className="btn primary big" disabled={busy}>Open shift</button>
    </form>
  );
}

const SummaryTable = ({ s, shift, cur, blind }) => blind ? (
  <table className="data"><tbody>
    <tr><td>Opening cash</td><td className="num">{fmt(shift.openingFloat)}</td></tr>
    <tr><td>Sales this shift</td><td className="num">{s.salesCount}</td></tr>
    <tr><td className="muted" colSpan={2}>Cash totals are shown after you close the shift and enter your count.</td></tr>
  </tbody></table>
) : (
  <table className="data"><tbody>
    <tr><td>Opening cash</td><td className="num">{fmt(shift.openingFloat)}</td></tr>
    <tr><td>Cash sales ({s.salesCount} sales in total)</td><td className="num">{s.cashSales > 0 ? "+" : ""}{fmt(s.cashSales)}</td></tr>
    <tr><td>Cash refunds</td><td className="num">{s.cashRefunds > 0 ? "−" : ""}{fmt(s.cashRefunds)}</td></tr>
    <tr><td><strong>Cash that should be in the drawer</strong></td><td className="num"><strong>{money(s.expectedCash, cur)}</strong></td></tr>
    <tr><td className="muted">Card sales (not in drawer)</td><td className="num muted">{fmt(s.cardSales)}</td></tr>
    <tr><td className="muted">Card refunds</td><td className="num muted">{fmt(s.cardRefunds)}</td></tr>
    <tr><td className="muted">Voided sales</td><td className="num muted">{s.voidCount} ({fmt(s.voidTotal)})</td></tr>
  </tbody></table>
);

export function MyShift() {
  const { shift, setShift, settings, refreshShift, online, can } = useSession();
  const [closing, setClosing] = useState(false);
  const history = useApi("/shifts", { status: "closed", limit: 10 });

  const reload = async () => { try { await refreshShift(); } catch (err) { toast.error(errorMessage(err)); } };

  return (
    <>
      <div className="page-head">
        <div><h1>My shift</h1><p>Open a shift with your starting cash and close it with a cash count at the end.</p></div>
        {shift && <button className="btn" onClick={reload} disabled={!online}>Refresh totals</button>}
      </div>
      {!shift ? (
        <div className="panel pad" style={{ maxWidth: 460 }}><OpenShiftForm onOpened={() => history.reload()} /></div>
      ) : (
        <div className="two-col">
          <div className="panel">
            <div className="modal-head" style={{ borderBottom: "1px solid var(--line)" }}>
              <div><h2>Shift open</h2><p className="muted small">Since {dateTime(shift.openedAt, settings.timezone)}</p></div>
              <button className="btn primary" onClick={() => setClosing(true)} disabled={!online}>Close shift</button>
            </div>
            {shift.summary ? <SummaryTable s={shift.summary} shift={shift} cur={settings.currency} blind={!can("manager")} /> : <Loading />}
          </div>
          <div className="panel pad stack">
            <h3>At the end of your shift</h3>
            <p>1. Finish any sale in progress.</p>
            <p>2. Count all the cash in the drawer.</p>
            <p>3. Press <strong>Close shift</strong> and enter the amount you counted. Any difference is recorded for the manager.</p>
            <Link to={`/sales?shiftId=${shift._id}`} className="small">See this shift's sales</Link>
          </div>
        </div>
      )}
      <h2 style={{ margin: "28px 0 10px" }}>My recent shifts</h2>
      <ShiftTable data={history.data} loading={history.loading} cur={settings.currency} tz={settings.timezone} />
      {closing && shift && (
        <CloseShiftModal shift={shift} onClose={() => setClosing(false)} onClosed={() => { setShift(null); setClosing(false); history.reload(); }} />
      )}
    </>
  );
}

export function CloseShiftModal({ shift, onClose, onClosed }) {
  const { settings } = useSession();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post(`/shifts/${shift._id}/close`, { countedCash: Number(counted), note });
      setResult(data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  if (result) {
    const v = result.variance;
    return (
      <Modal title="Shift closed" onClose={() => onClosed(result)} footer={<div className="actions"><button className="btn primary" onClick={() => onClosed(result)}>Done</button></div>}>
        <div className="stack">
          <div className={`change-box${v < 0 ? " short" : ""}`}>
            <span>{v === 0 ? "Cash matches exactly" : v < 0 ? "Drawer is short by" : "Drawer is over by"}</span>
            <span className="amount">{fmt(Math.abs(v))}</span>
          </div>
          <SummaryTable s={result.summary} shift={result} cur={settings.currency} />
          <p className="muted small">Counted {money(result.countedCash, settings.currency)}; expected {money(result.expectedCash, settings.currency)}.</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Close shift" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="counted">Cash counted in the drawer ({settings.currency})</label>
          <input id="counted" className="tender-amount" type="number" min="0" step="0.01" inputMode="decimal" required value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          <span className="hint">Count the notes and coins first. The expected amount is shown after you close, so the count stays honest.</span>
        </div>
        <div className="field">
          <label htmlFor="note">Note (optional)</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid 500 to the delivery driver from the drawer" />
        </div>
        <button className="btn primary big" disabled={busy || counted === ""}>Close shift</button>
      </form>
    </Modal>
  );
}

function ShiftTable({ data, loading, cur, tz, showUser, onOpen, page, onPage }) {
  if (loading && !data) return <div className="panel"><Loading /></div>;
  if (!data?.shifts?.length) return <div className="panel"><Empty title="No shifts yet" /></div>;
  return (
    <div className="panel">
      <div className="table-wrap">
        <table className="data">
          <thead><tr>
            {showUser && <th>Staff</th>}<th>Opened</th><th>Closed</th><th className="num">Opening cash</th>
            <th className="num">Expected</th><th className="num">Counted</th><th className="num">Difference</th>
          </tr></thead>
          <tbody>
            {data.shifts.map((s) => (
              <tr key={s._id} className={onOpen ? "clickable" : ""} onClick={() => onOpen?.(s)}>
                {showUser && <td>{s.user.name}</td>}
                <td>{dateTime(s.openedAt, tz)}</td>
                <td>{s.closedAt ? dateTime(s.closedAt, tz) : <span className="badge green">Open</span>}</td>
                <td className="num">{fmt(s.openingFloat)}</td>
                <td className="num">{s.expectedCash != null ? fmt(s.expectedCash) : ""}</td>
                <td className="num">{s.countedCash != null ? fmt(s.countedCash) : ""}</td>
                <td className="num">
                  {s.variance == null ? "" : s.variance === 0 ? <span className="badge green">Exact</span>
                    : <span className={`badge ${s.variance < 0 ? "red" : "saffron"}`}>{s.variance > 0 ? "+" : "−"}{fmt(Math.abs(s.variance))}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPage && <Pager page={page} totalPages={data.totalPages} total={data.total} onPage={onPage} noun="shifts" />}
      <span className="visually-hidden">{cur}</span>
    </div>
  );
}

export function AllShifts() {
  const { settings } = useSession();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const list = useApi("/shifts", { status, page, limit: 30 });
  const detail = useApi(open ? `/shifts/${open._id}` : null);
  return (
    <>
      <div className="page-head"><div><h1>All shifts</h1><p>Cash-ups for every till. Differences show cash short (red) or over.</p></div></div>
      <div className="toolbar">
        <div className="field"><label htmlFor="st">Show</label>
          <select id="st" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="all">All shifts</option><option value="open">Open now</option><option value="closed">Closed</option>
          </select>
        </div>
      </div>
      <ShiftTable data={list.data} loading={list.loading} cur={settings.currency} tz={settings.timezone} showUser onOpen={setOpen} page={page} onPage={setPage} />
      {open && (
        <ShiftDetail shift={open} detail={detail} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); list.reload(); }} />
      )}
    </>
  );
}

function ShiftDetail({ shift, detail, onClose, onChanged }) {
  const { settings } = useSession();
  const [closing, setClosing] = useState(false);
  const d = detail.data;
  return (
    <Modal title={`${shift.user.name}'s shift`} onClose={onClose} wide
      footer={<div className="actions">
        <Link className="btn" to={`/sales?shiftId=${shift._id}`}>View sales</Link>
        {shift.status === "open" && <button className="btn primary" onClick={() => setClosing(true)}>Close this shift</button>}
      </div>}>
      {!d ? <Loading /> : (
        <div className="stack">
          <p className="muted">Opened {dateTime(d.openedAt, settings.timezone)}{d.closedAt && `, closed ${dateTime(d.closedAt, settings.timezone)} by ${d.closedBy?.name}`}</p>
          <SummaryTable s={d.summary} shift={d} cur={settings.currency} />
          {d.closedAt && <p>Counted {money(d.countedCash, settings.currency)}. Difference {fmt(d.variance)}.</p>}
          {d.note && <p><strong>Note:</strong> {d.note}</p>}
        </div>
      )}
      {closing && <CloseShiftModal shift={shift} onClose={() => setClosing(false)} onClosed={onChanged} />}
    </Modal>
  );
}
