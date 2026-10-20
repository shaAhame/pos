import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { downloadFile, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi } from "../lib/hooks";
import { fmt, money } from "../lib/money";
import { addDays, todayISO } from "../lib/format";
import { Empty, Loading } from "../components/ui";

const presets = (tz) => {
  const t = todayISO(tz);
  const monthStart = t.slice(0, 8) + "01";
  return {
    today: { label: "Today", from: t, to: t },
    yesterday: { label: "Yesterday", from: addDays(t, -1), to: addDays(t, -1) },
    week: { label: "Last 7 days", from: addDays(t, -6), to: t },
    month: { label: "This month", from: monthStart, to: t },
    days30: { label: "Last 30 days", from: addDays(t, -29), to: t },
  };
};

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v);
};
const shortDay = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function DailyChart({ rows, currency }) {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  // Keep the tooltip inside the chart: anchor it left/right near the edges.
  const tipStyle = (t) => {
    const w = ref.current?.offsetWidth || 0;
    const shift = t.x < 120 ? "0%" : t.x > w - 160 ? "-100%" : "-50%";
    return { left: t.x, top: t.y, transform: `translate(${shift}, -100%)` };
  };
  const max = niceMax(Math.max(...rows.map((r) => r.netSales), 0));
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      {ticks.map((t) => (
        <div key={t}>
          <div className="grid" style={{ top: 8 + 180 * (1 - t / max) }} />
          <div className="tick" style={{ top: 8 + 180 * (1 - t / max) }}>{compact(t)}</div>
        </div>
      ))}
      <div className="bars" role="img" aria-label={`Net sales per day, highest ${money(Math.max(...rows.map((r) => r.netSales)), currency)}`}>
        {rows.map((r, i) => (
          <div key={r.day} className="slot" tabIndex={0}
            onMouseEnter={(e) => setTip({ r, x: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2 + 44, y: 8 + 180 * (1 - Math.max(r.netSales, 0) / max) })}
            onFocus={(e) => setTip({ r, x: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2 + 44, y: 8 + 180 * (1 - Math.max(r.netSales, 0) / max) })}
            onBlur={() => setTip(null)} aria-label={`${shortDay(r.day)}: ${fmt(r.netSales)}`}>
            <div className="bar" style={{ height: `${(Math.max(r.netSales, 0) / max) * 100}%` }} data-i={i} />
          </div>
        ))}
      </div>
      {tip && (
        <div className="chart-tip" style={tipStyle(tip)}>
          <strong>{shortDay(tip.r.day)}</strong>: {money(tip.r.netSales, currency)} from {tip.r.salesCount} sale{tip.r.salesCount === 1 ? "" : "s"}
          {tip.r.refunds > 0 && <> (refunds {fmt(tip.r.refunds)})</>}
        </div>
      )}
      <div className="bars-axis" style={{ paddingLeft: 0 }}><span>{shortDay(rows[0].day)}</span><span>{shortDay(rows[rows.length - 1].day)}</span></div>
    </div>
  );
}

export default function Reports() {
  const { settings } = useSession();
  const cur = settings.currency;
  const P = useMemo(() => presets(settings.timezone), [settings.timezone]);
  const [preset, setPreset] = useState("today");
  const [custom, setCustom] = useState({ from: P.week.from, to: P.week.to });
  const range = preset === "custom" ? custom : P[preset];
  const params = { from: range.from, to: range.to };
  const summary = useApi("/reports/summary", params);
  const daily = useApi(range.from !== range.to ? "/reports/daily" : null, params);
  const top = useApi("/reports/top-products", { ...params, limit: 10 });
  const low = useApi("/reports/low-stock");
  const [asTable, setAsTable] = useState(false);
  const s = summary.data;

  const exportCsv = async () => {
    try { await downloadFile("/reports/sales.csv", params, `sales_${range.from}_to_${range.to}.csv`); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><p>Sales, profit and stock for the period you pick.</p></div>
        <button className="btn" onClick={exportCsv}>Download sales (CSV)</button>
      </div>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Period" style={{ margin: 0 }}>
          {Object.entries(P).map(([k, v]) => <button key={k} className="chip" aria-pressed={preset === k} onClick={() => setPreset(k)}>{v.label}</button>)}
          <button className="chip" aria-pressed={preset === "custom"} onClick={() => setPreset("custom")}>Pick dates</button>
        </div>
        {preset === "custom" && (
          <>
            <div className="field"><label htmlFor="rf">From</label><input id="rf" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></div>
            <div className="field"><label htmlFor="rt">To</label><input id="rt" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></div>
          </>
        )}
      </div>

      {summary.error ? <div className="panel"><Empty title="Couldn't load the report">{summary.error}</Empty></div> : !s ? <div className="panel"><Loading /></div> : (
        <>
          {s.offlineReviewCount > 0 && (
            <div className="notice"><span>{s.offlineReviewCount} sale{s.offlineReviewCount > 1 ? "s" : ""} made offline need checking (stock or price differences).</span><Link className="btn small" to="/sales">Review in Sales</Link></div>
          )}
          <div className="kpis">
            <div className="kpi"><div className="k">Net sales ({cur})</div><div className="v">{fmt(s.netSales)}</div><div className="s">after {fmt(s.refunds)} refunds</div></div>
            <div className="kpi"><div className="k">Sales</div><div className="v">{s.salesCount}</div><div className="s">average {fmt(s.averageSale)}</div></div>
            <div className="kpi"><div className="k">Gross profit ({cur})</div><div className="v">{fmt(s.grossProfit)}</div><div className="s">{s.profitCoverage === "full" ? "all items have a cost price" : "only items with a cost price"}</div></div>
            <div className="kpi"><div className="k">Cash / card ({cur})</div><div className="v" style={{ fontSize: "var(--step-1)" }}>{fmt(s.cashSales)} / {fmt(s.cardSales)}</div><div className="s">{s.itemsSold} items sold</div></div>
            <div className="kpi"><div className="k">Returns and voids</div><div className="v">{s.returnCount} / {s.voidCount}</div><div className="s">voided {fmt(s.voidTotal)}</div></div>
            <div className="kpi"><div className="k">Discounts / tax ({cur})</div><div className="v" style={{ fontSize: "var(--step-1)" }}>{fmt(s.discounts)} / {fmt(s.tax)}</div></div>
          </div>

          {range.from !== range.to && (
            <div className="panel pad" style={{ marginBottom: 16 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <h3>Net sales per day</h3>
                <button className="btn small" onClick={() => setAsTable((t) => !t)}>{asTable ? "Show chart" : "Show as table"}</button>
              </div>
              {!daily.data ? <Loading /> : asTable ? (
                <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Day</th><th className="num">Sales</th><th className="num">Gross</th><th className="num">Refunds</th><th className="num">Net</th></tr></thead>
                    <tbody>{daily.data.map((d) => <tr key={d.day}><td>{shortDay(d.day)}</td><td className="num">{d.salesCount}</td><td className="num">{fmt(d.grossSales)}</td><td className="num">{fmt(d.refunds)}</td><td className="num"><strong>{fmt(d.netSales)}</strong></td></tr>)}</tbody>
                  </table>
                </div>
              ) : <DailyChart rows={daily.data} currency={cur} />}
            </div>
          )}

          <div className="two-col">
            <div className="panel">
              <div className="modal-head"><h3>Best sellers</h3></div>
              {!top.data ? <Loading /> : !top.data.length ? <Empty title="No sales in this period" /> : (
                <table className="data">
                  <thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Revenue ({cur})</th></tr></thead>
                  <tbody>{top.data.map((t) => <tr key={t.productId || t.name}><td>{t.name}</td><td className="num">{t.quantity}</td><td className="num">{fmt(t.revenue)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="panel">
              <div className="modal-head"><h3>Running low</h3><Link to="/products" className="small">Products</Link></div>
              {!low.data ? <Loading /> : !low.data.length ? <Empty title="Nothing is running low" /> : (
                <table className="data">
                  <thead><tr><th>Product</th><th className="num">Left</th><th className="num">Warn at</th></tr></thead>
                  <tbody>{low.data.slice(0, 15).map((p) => <tr key={p._id}><td>{p.name}</td><td className="num">{p.quantity <= 0 ? <span className="badge red">0</span> : <span className="badge saffron">{p.quantity}</span>}</td><td className="num muted">{p.lowStockThreshold}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
