import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { dateOnly, dateTime } from "../lib/format";
import { Empty } from "../components/ui";

const STATUS = { in_stock: "In stock", in_transit: "On the way to a branch", sold: "Sold", defective: "Faulty (returned)", with_supplier: "With supplier", written_off: "Written off", missing: "Missing", in_repair: "In repair" };

export default function Warranty() {
  const { settings } = useSession();
  const tz = settings.timezone;
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const search = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setError("");
    try { setResults((await api.get("/serials/lookup", { params: { q: q.trim() } })).data); }
    catch (err) { setError(errorMessage(err)); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Warranty lookup</h1><p>Scan or type an IMEI / serial number, an invoice number, or the customer's phone number.</p></div></div>
      <form className="toolbar" onSubmit={search}>
        <div className="field grow" style={{ maxWidth: 420 }}><label htmlFor="wq">Search</label>
          <input id="wq" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="IMEI, serial, INV-000123 or 077 123 4567" /></div>
        <button className="btn primary">Look up</button>
      </form>
      {error && <div className="notice red">{error}</div>}
      {results && !results.length && <div className="panel"><Empty title="Nothing found">Check the number. Units bought elsewhere won't be in this system.</Empty></div>}
      <div className="stack">
        {(results || []).map((r, k) => (
          <div key={k} className="panel pad stack">
            <div className="row between">
              <div><h2>{r.product}</h2>{r.serial && <div className="muted">Serial / IMEI {r.serial}{r.status ? `, ${STATUS[r.status] || r.status}` : ""}</div>}{r.serials && <div className="muted">S/N {r.serials}</div>}</div>
              {r.warrantyUntil ? (r.underWarranty
                ? <span className="badge green" style={{ fontSize: "var(--step-0)", padding: "6px 12px" }}>Under warranty until {dateOnly(r.warrantyUntil + "T12:00:00Z", tz)}</span>
                : <span className="badge red" style={{ fontSize: "var(--step-0)", padding: "6px 12px" }}>Warranty ended {dateOnly(r.warrantyUntil + "T12:00:00Z", tz)}</span>)
                : r.status === "sold" ? <span className="badge">No warranty</span> : null}
            </div>
            {r.invoiceNumber && <p>Sold on <strong>{r.invoiceNumber}</strong>, {dateOnly(r.soldAt, tz)}{r.soldAtBranch ? ` at ${r.soldAtBranch}` : ""}{r.customerName ? ` to ${r.customerName}` : ""}{r.customerPhone ? ` (${r.customerPhone})` : ""}.</p>}
            {r.repairs?.length > 0 && <p>Repairs: {r.repairs.map((j) => `${j.jobNumber} (${j.status.replace("_", " ")})`).join(", ")}</p>}
            {r.events?.length > 0 && (
              <details><summary>History of this unit ({r.events.length})</summary>
                <table className="data"><tbody>{r.events.map((e, i) => (
                  <tr key={i}><td>{dateTime(e.at, tz)}</td><td>{e.event}</td><td>{e.location || ""}</td><td className="small">{[e.ref, e.note, e.by].filter(Boolean).join(", ")}</td></tr>
                ))}</tbody></table>
              </details>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
