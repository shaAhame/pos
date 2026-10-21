import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage, isConnectionError } from "../lib/api";
import { useSession } from "../lib/session";
import { computeTotals, fmt, lineTotal, money, quickCash, round2 } from "../lib/money";
import { load, save } from "../lib/storage";
import { enqueue } from "../lib/offline";
import { uuid } from "../lib/uuid";
import { useDebounced } from "../lib/hooks";
import Modal from "../components/Modal";
import { Receipt, PrintReceipt, printNow } from "../components/Receipt";
import { OpenShiftForm } from "./Shifts";

const CATALOG_KEY = "pos.catalog";
const CART_KEY = "pos.cart";
const nameOf = (p) => p.displayName || (p.variant ? `${p.name} ${p.variant}` : p.name);

export default function Till() {
  const { user, settings, shift, online, setOnline, refreshShift, can, has, multiBranch, location, locationId } = useSession();
  const tillLocationId = shift?.location?._id || locationId || null;
  const tillLocation = shift?.location || location;
  const catalogKey = `${CATALOG_KEY}.${tillLocationId || "default"}`;
  const [catalog, setCatalog] = useState(() => load(catalogKey, []));
  const [catalogState, setCatalogState] = useState("loading");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const saved = load(CART_KEY, null);
  const mine = saved?.userId === user._id;
  const [cart, setCart] = useState(mine ? saved.cart || [] : []);
  const [discount, setDiscount] = useState(mine ? saved.discount : 0);
  const [taxRate, setTaxRate] = useState(mine ? saved.taxRate : settings.defaultTaxRate || 0);
  const [customer, setCustomer] = useState(mine ? saved.customer : null);
  const [paying, setPaying] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [picking, setPicking] = useState(null);   // product to choose serials for
  const [approvalFor, setApprovalFor] = useState(null);
  const [done, setDone] = useState(null);
  const searchRef = useRef(null);
  const serialsOn = has("serials");

  useEffect(() => { save(CART_KEY, { userId: user._id, cart, discount, taxRate, customer }); }, [user._id, cart, discount, taxRate, customer]);

  const loadCatalog = useCallback(async () => {
    try {
      const { data } = await api.get("/products", { params: { limit: 5000, status: "active", locationId: tillLocationId || undefined } });
      setCatalog(data.products); save(catalogKey, data.products);
      setCatalogState("ok"); setOnline(true);
    } catch (err) {
      setCatalogState(isConnectionError(err) ? "offline" : "error");
      if (isConnectionError(err)) setOnline(false);
    }
  }, [setOnline, tillLocationId, catalogKey]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const byId = useMemo(() => new Map(catalog.map((p) => [p._id, p])), [catalog]);
  const categories = useMemo(() => [...new Set(catalog.map((p) => p.category))].sort(), [catalog]);
  const q = useDebounced(search.trim().toLowerCase(), 120);
  const results = useMemo(() => {
    let list = catalog;
    if (category) list = list.filter((p) => p.category === category);
    if (q) list = list.filter((p) => nameOf(p).toLowerCase().includes(q) || (p.model || "").toLowerCase().includes(q) || (p.barcode || "").toLowerCase().startsWith(q));
    return list.slice(0, 60);
  }, [catalog, category, q]);

  const inCart = (id) => cart.find((l) => l.product === id)?.quantity || 0;
  const tracked = (p) => serialsOn && p.trackSerials;

  const addLine = (p, { qty = 1, serials = [] } = {}) => {
    setCart((c) => {
      const ex = c.find((l) => l.product === p._id);
      if (ex) {
        const allSerials = [...ex.serials, ...serials.filter((s) => !ex.serials.includes(s))];
        return c.map((l) => (l.product === p._id ? { ...l, serials: allSerials, quantity: tracked(p) ? allSerials.length : l.quantity + qty } : l));
      }
      return [...c, { product: p._id, name: nameOf(p), price: p.price, quantity: tracked(p) ? serials.length : qty, discount: 0, serials, tracked: tracked(p) }];
    });
  };

  const add = (p, scannedSerial) => {
    if (!p) return;
    if (tracked(p)) {
      if (scannedSerial) {
        if (cart.some((l) => l.serials.includes(scannedSerial))) return toast.info(`${scannedSerial} is already in this sale`);
        return addLine(p, { serials: [scannedSerial] });
      }
      return setPicking(p);
    }
    const stock = byId.get(p._id)?.quantity ?? p.quantity;
    if (inCart(p._id) + 1 > stock) {
      if (online) return toast.warn(`Only ${stock} of "${nameOf(p)}" in stock`);
      toast.warn(`Stock shows ${stock} of "${nameOf(p)}". Selling anyway while offline.`);
    }
    addLine(p);
  };

  const setQty = (id, qty) => {
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const stock = byId.get(id)?.quantity ?? Infinity;
    if (n > stock && online) toast.warn(`Only ${stock} in stock`);
    setCart((c) => c.map((l) => (l.product === id ? { ...l, quantity: online ? Math.min(n, Math.max(stock, 1)) : n } : l)));
  };
  const removeSerial = (id, serial) => setCart((c) => c.flatMap((l) => {
    if (l.product !== id) return [l];
    const serials = l.serials.filter((s) => s !== serial);
    return serials.length ? [{ ...l, serials, quantity: serials.length }] : [];
  }));
  const setLineDiscount = (id, v) => setCart((c) => c.map((l) => (l.product === id ? { ...l, discount: Math.max(0, Math.min(Number(v) || 0, l.price * l.quantity)) } : l)));

  const onSearchKey = async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = search.trim();
    if (!code) return;
    const exact = catalog.find((p) => p.barcode && p.barcode === code);
    if (exact) { add(exact); setSearch(""); return; }
    if (results.length === 1) { add(results[0]); setSearch(""); return; }
    if (online && serialsOn) {
      // maybe it's an IMEI / serial number
      try {
        const { data } = await api.get(`/products/barcode/${encodeURIComponent(code)}`, { params: { locationId: tillLocationId || undefined } });
        if (data.scannedSerial) {
          if (data.scannedSerial.status !== "in_stock" || !data.scannedSerial.here) return toast.error(`${data.scannedSerial.serial} isn't available here (${data.scannedSerial.status.replace("_", " ")})`);
          add(byId.get(data._id) || data, data.scannedSerial.serial); setSearch(""); return;
        }
        add(byId.get(data._id) || data); setSearch(""); return;
      } catch { /* fall through */ }
    }
    if (!results.length) toast.error(`Nothing matches "${code}"`);
  };

  const totals = computeTotals(cart, Number(discount) || 0, Number(taxRate) || 0);
  const maxDisc = 100; // cashiers may enter more than their limit; a manager then approves it with a PIN
  const lineDiscounts = has("lineDiscounts");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F9" && cart.length && !paying && !done && !picking) { e.preventDefault(); setPaying(true); }
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length, paying, done, picking]);

  const clearSale = () => {
    setCart([]); setDiscount(0); setTaxRate(settings.defaultTaxRate || 0); setCustomer(null);
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  // Called by the payment dialog (and again after a manager approves a discount).
  const complete = async (pay, approval) => {
    const clientRef = pay.clientRef || uuid();
    const payload = {
      clientRef,
      items: cart.map((l) => ({ product: l.product, quantity: l.quantity, discount: l.discount || 0, serials: l.serials })),
      customer: customer?._id || null,
      customerName: customer?._id ? "" : (customer?.name || ""),
      discount: Number(discount) || 0,
      taxRate: Number(taxRate) || 0,
      payments: pay.payments,
      cashTendered: pay.cashTendered,
      tradeIn: pay.tradeIn || undefined,
      installment: pay.installment || undefined,
      approval: approval || undefined,
    };
    try {
      const { data } = await api.post("/sales", payload);
      setPaying(false); setApprovalFor(null);
      setDone({ sale: data.sale });
      clearSale(); loadCatalog();
      return true;
    } catch (err) {
      if (isConnectionError(err)) {
        if (pay.tradeIn || pay.installment) { toast.error("Trade-ins and installments need a connection. Take the full payment, or try again when online."); return false; }
        const createdAt = new Date().toISOString();
        const offlinePayload = { ...payload, offline: true, createdAt, shiftId: shift?._id || null,
          items: cart.map((l) => ({ product: l.product, quantity: l.quantity, discount: l.discount || 0, serials: l.serials, price: l.price, name: l.name })) };
        const cashPart = (pay.payments || []).filter((p) => p.method === "Cash").reduce((t, p) => t + p.amount, 0);
        const receipt = {
          pending: true, invoiceNumber: `OFF-${clientRef.slice(0, 8).toUpperCase()}`, date: createdAt, cashier: user,
          customerName: customer?.name || "Walk-in Customer", location: tillLocation,
          items: cart.map((l) => ({ ...l, total: lineTotal(l), serials: l.serials.map((s) => ({ serial: s })) })),
          discount: payload.discount, taxRate: payload.taxRate, ...totals, payments: pay.payments,
          amountTendered: pay.cashTendered, changeGiven: pay.cashTendered != null && cashPart ? round2(pay.cashTendered - cashPart) : null,
        };
        try { enqueue({ clientRef, userId: user._id, payload: offlinePayload, receipt, queuedAt: createdAt }); }
        catch (e) { toast.error(e.message); return false; }
        const next = catalog.map((p) => { const l = cart.find((x) => x.product === p._id); return l ? { ...p, quantity: Math.max(0, p.quantity - l.quantity) } : p; });
        setCatalog(next); save(catalogKey, next);
        setOnline(false); setPaying(false);
        setDone({ sale: receipt }); clearSale();
        toast.warn("No connection. Sale saved on this till and will upload automatically.");
        return true;
      }
      const code = err.response?.data?.code;
      if (code === "APPROVAL_REQUIRED") { setApprovalFor({ pay: { ...pay, clientRef }, pct: err.response.data.discountPct }); return false; }
      if (code === "SHIFT_REQUIRED") { refreshShift().catch(() => {}); setPaying(false); }
      if (err.response?.status === 409) loadCatalog();
      toast.error(errorMessage(err, "Sale failed"));
      return false;
    }
  };

  if (!shift && online && user.role === "owner" && multiBranch && (!location || location.type !== "store")) {
    return (<><div className="page-head"><div><h1>Till</h1><p>Choose which shop you're selling in.</p></div></div>
      <div className="notice">Pick a shop in the branch menu at the top of the screen, then open your shift.</div></>);
  }
  if (!shift && online) {
    return (<><div className="page-head"><div><h1>Till</h1><p>Open your shift to start selling{multiBranch && tillLocation ? ` at ${tillLocation.name}` : ""}.</p></div></div>
      <div className="panel pad" style={{ maxWidth: 460 }}><OpenShiftForm onOpened={() => searchRef.current?.focus()} /></div></>);
  }

  return (
    <>
      {catalogState === "offline" && <div className="notice">You're offline. Selling from the saved product list; sales will upload when the connection returns.</div>}
      {catalogState === "error" && <div className="notice red">Couldn't load products. <button className="btn small" onClick={loadCatalog}>Try again</button></div>}
      {!shift && !online && <div className="notice">No shift is open on this till. Offline sales will still be saved and flagged for the manager.</div>}

      <div className="till">
        <section aria-label="Products">
          <div className="till-search">
            <label htmlFor="till-search" className="visually-hidden">Scan a barcode or IMEI, or search products</label>
            <input id="till-search" ref={searchRef} type="search" autoComplete="off"
              placeholder={serialsOn ? "Scan barcode or IMEI, or search (F2)" : "Scan barcode or search (F2)"}
              value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} />
          </div>
          {categories.length > 1 && (
            <div className="chips" role="group" aria-label="Categories">
              <button className="chip" aria-pressed={!category} onClick={() => setCategory("")}>All</button>
              {categories.map((c) => <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c === category ? "" : c)}>{c}</button>)}
            </div>
          )}
          {!catalog.length && catalogState !== "loading" ? (
            <div className="panel empty"><strong>No products yet</strong>{can("owner") ? "Add products on the Products page." : "Ask the owner to add products."}</div>
          ) : (
            <div className="tiles" style={{ marginTop: categories.length > 1 ? 0 : 12 }}>
              {results.map((p) => {
                const left = p.quantity - inCart(p._id);
                return (
                  <button key={p._id} className="tile" onClick={() => add(p)} disabled={online && left <= 0}>
                    <span className="name">{nameOf(p)}</span>
                    <span className="meta">
                      <span className="price">{fmt(p.price)}</span>
                      <span className={left <= p.lowStockThreshold ? (left <= 0 ? "danger-text" : "") : "muted"}>{left <= 0 ? "Out of stock" : `${left} left`}</span>
                    </span>
                  </button>
                );
              })}
              {!results.length && catalog.length > 0 && <div className="muted">Nothing matches "{search}".</div>}
            </div>
          )}
        </section>

        <aside className="tape" aria-label="Current sale">
          <div className="tape-head">
            <div>
              <strong>{customer ? customer.name : "Walk-in customer"}</strong>
              {customer?.contactNumber && <div className="small muted">{customer.contactNumber}</div>}
            </div>
            <div className="row">
              <button className="btn small" onClick={() => setCustOpen(true)}>{customer ? "Change" : "Customer"}</button>
              {cart.length > 0 && <button className="btn small danger" onClick={() => { if (window.confirm("Clear this sale?")) clearSale(); }}>Clear</button>}
            </div>
          </div>
          <div className="tape-lines">
            {!cart.length && <div className="empty small">Scan or tap a product to start a sale.</div>}
            {cart.map((l) => (
              <div className="line" key={l.product}>
                <span className="lname">{l.name}</span>
                <span className="lsum">{fmt(lineTotal(l))}</span>
                {l.tracked ? (
                  <div className="lctl" style={{ flexWrap: "wrap" }}>
                    {l.serials.map((s) => (
                      <span key={s} className="serial-chip">{s}<button aria-label={`Remove ${s}`} onClick={() => removeSerial(l.product, s)}>×</button></span>
                    ))}
                    <button className="btn ghost small" onClick={() => setPicking(byId.get(l.product) || { _id: l.product, name: l.name, trackSerials: true })}>Add unit</button>
                    <span className="small muted">× {fmt(l.price)}</span>
                  </div>
                ) : (
                  <div className="lctl">
                    <div className="qty">
                      <button onClick={() => (l.quantity > 1 ? setQty(l.product, l.quantity - 1) : setCart((c) => c.filter((x) => x.product !== l.product)))} aria-label={`One less ${l.name}`}>−</button>
                      <input type="number" min="1" value={l.quantity} onChange={(e) => setQty(l.product, e.target.value)} aria-label={`Quantity of ${l.name}`} />
                      <button onClick={() => setQty(l.product, l.quantity + 1)} aria-label={`One more ${l.name}`}>+</button>
                    </div>
                    <span className="small muted">× {fmt(l.price)}</span>
                    <span className="grow" />
                    <button className="btn ghost small" onClick={() => setCart((c) => c.filter((x) => x.product !== l.product))}>Remove</button>
                  </div>
                )}
                {lineDiscounts && (
                  <div className="lctl small">
                    <label htmlFor={`ld-${l.product}`} className="muted">Item discount</label>
                    <input id={`ld-${l.product}`} type="number" min="0" step="1" value={l.discount || ""} placeholder="0" style={{ width: 110, minHeight: 30, padding: "2px 8px" }}
                      onChange={(e) => setLineDiscount(l.product, e.target.value)} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {cart.length > 0 && (
            <div className="tape-extra">
              <div className="field"><label htmlFor="disc">Discount %</label>
                <input id="disc" type="number" min="0" max={maxDisc} step="0.5" value={discount} onChange={(e) => setDiscount(Math.min(maxDisc, Math.max(0, Number(e.target.value) || 0)))} /></div>
              <div className="field"><label htmlFor="tax">Tax %</label>
                <input id="tax" type="number" min="0" max="100" step="0.5" value={taxRate} onChange={(e) => setTaxRate(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
            </div>
          )}
          <div className="tape-sums">
            <span className="k">Subtotal</span><span className="v">{fmt(totals.subtotal)}</span>
            {totals.discountAmount > 0 && <><span className="k">Discount</span><span className="v">−{fmt(totals.discountAmount)}</span></>}
            {totals.taxAmount > 0 && <><span className="k">Tax</span><span className="v">{fmt(totals.taxAmount)}</span></>}
          </div>
          <div className="tape-total"><span>Total {settings.currency}</span><span className="amount">{fmt(totals.totalAmount)}</span></div>
          <div className="tape-pay"><button className="btn primary big block" disabled={!cart.length} onClick={() => setPaying(true)}>Pay (F9)</button></div>
        </aside>
      </div>

      {paying && <PayModal total={totals.totalAmount} customer={customer} catalog={catalog} onClose={() => setPaying(false)} onComplete={complete} />}
      {picking && <SerialPicker product={picking} locationId={tillLocationId} online={online} taken={cart.flatMap((l) => l.serials)}
        onClose={() => setPicking(null)} onPick={(serials) => { addLine(picking, { serials }); setPicking(null); }} />}
      {approvalFor && <ApprovalModal pct={approvalFor.pct} onClose={() => setApprovalFor(null)} onApprove={(approval) => complete(approvalFor.pay, approval)} />}
      {custOpen && <CustomerPicker online={online} onClose={() => setCustOpen(false)} onPick={(c) => { setCustomer(c); setCustOpen(false); }} />}
      {done && <DoneModal sale={done.sale} settings={settings} onClose={() => { setDone(null); setTimeout(() => searchRef.current?.focus(), 0); }} />}
    </>
  );
}

// Choose which units (serial / IMEI) are being sold.
function SerialPicker({ product, locationId, online, taken, onClose, onPick }) {
  const [units, setUnits] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!online) { setUnits([]); return; }
    api.get(`/products/${product._id}/serials`, { params: { locationId: locationId || undefined } })
      .then((r) => setUnits(r.data.filter((u) => !taken.includes(u.serial)))).catch(() => setUnits([]));
  }, [product._id, locationId, online, taken]);
  const addTyped = () => {
    const s = typed.trim().toUpperCase();
    if (!s) return;
    if (taken.includes(s) || chosen.includes(s)) { toast.info(`${s} is already chosen`); setTyped(""); return; }
    if (online && units && !units.some((u) => u.serial.toUpperCase() === s)) { toast.error(`${s} isn't in stock here`); return; }
    setChosen([...chosen, s]); setTyped("");
  };
  const toggle = (s) => setChosen((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));
  return (
    <Modal title={`Which ${nameOf(product)}?`} onClose={onClose}
      footer={<div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!chosen.length} onClick={() => onPick(chosen)}>Add {chosen.length || ""} to sale</button></div>}>
      <div className="stack">
        <div className="field">
          <label htmlFor="sp">Scan or type the serial / IMEI</label>
          <input id="sp" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }} />
        </div>
        {chosen.length > 0 && <div className="row">{chosen.map((s) => <span key={s} className="serial-chip">{s}<button aria-label={`Remove ${s}`} onClick={() => toggle(s)}>×</button></span>)}</div>}
        {units === null ? <p className="muted">Loading units…</p> : units.length ? (
          <div>
            <p className="small muted">Or tap a unit in stock here:</p>
            <div className="serial-grid">
              {units.map((u) => <button key={u._id} type="button" className="chip" aria-pressed={chosen.includes(u.serial)} onClick={() => toggle(u.serial)}>{u.serial}</button>)}
            </div>
          </div>
        ) : <p className="muted">{online ? "No units of this product are in stock here." : "Offline: type the serial from the box."}</p>}
      </div>
    </Modal>
  );
}

// Payment: one or more methods, optional trade-in and installments.
function PayModal({ total, customer, catalog, onClose, onComplete }) {
  const { settings, has, online } = useSession();
  const split = has("splitPayments");
  const [amounts, setAmounts] = useState({ Cash: total, Card: 0, Bank: 0 });
  const [single, setSingle] = useState("Cash");
  const [cashGiven, setCashGiven] = useState("");
  const [tradeOn, setTradeOn] = useState(false);
  const [trade, setTrade] = useState({ description: "", serial: "", condition: "", value: "", productId: "" });
  const [instOn, setInstOn] = useState(false);
  const [inst, setInst] = useState({ months: 6, fee: "", firstDue: "" });
  const [busy, setBusy] = useState(false);
  const canTrade = has("tradeIns") && online;
  const canInst = has("installments") && online;

  const tradeValue = tradeOn ? Number(trade.value) || 0 : 0;
  const pays = split
    ? ["Cash", "Card", "Bank"].map((m) => ({ method: m, amount: round2(Number(amounts[m]) || 0) })).filter((p) => p.amount > 0)
    : [{ method: single, amount: instOn ? round2(Number(amounts.down) || 0) : round2(Math.max(0, total - tradeValue)) }].filter((p) => p.amount > 0);
  const paid = round2(pays.reduce((t, p) => t + p.amount, 0) + tradeValue);
  const credit = instOn ? round2(total - paid) : 0;
  const remaining = round2(total - paid - credit);
  const cashPart = pays.filter((p) => p.method === "Cash").reduce((t, p) => t + p.amount, 0);
  const change = cashGiven === "" ? null : round2(Number(cashGiven) - cashPart);
  const monthly = instOn && inst.months > 0 ? round2((credit + (Number(inst.fee) || 0)) / inst.months) : 0;

  // Installments on: what's typed above becomes the down payment, so start from zero. Off: back to full amount in cash.
  useEffect(() => {
    if (!split) return;
    setAmounts(instOn ? { Cash: 0, Card: 0, Bank: 0 } : { Cash: Math.max(0, round2(total - tradeValue)), Card: 0, Bank: 0 });
  }, [instOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the remaining amount on cash when trade-in value changes (split mode)
  useEffect(() => { if (split && !instOn) setAmounts((a) => ({ ...a, Cash: Math.max(0, round2(total - tradeValue - (Number(a.Card) || 0) - (Number(a.Bank) || 0))) })); }, [tradeValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const allBy = (m) => setAmounts({ Cash: 0, Card: 0, Bank: 0, [m]: Math.max(0, round2(total - tradeValue)) });
  const valid = Math.abs(remaining) < 0.005 && (!instOn || (credit > 0 && customer?._id)) && (!tradeOn || (trade.description.trim() && tradeValue > 0))
    && (change === null || change >= -0.005);

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onComplete({
        payments: pays,
        cashTendered: cashPart > 0 && cashGiven !== "" ? Number(cashGiven) : null,
        tradeIn: tradeOn ? { description: trade.description.trim(), serial: trade.serial.trim(), condition: trade.condition.trim(), value: tradeValue, productId: trade.productId || null } : null,
        installment: instOn ? { months: Number(inst.months), fee: Number(inst.fee) || 0, firstDue: inst.firstDue || undefined } : null,
      });
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Take payment: ${money(total, settings.currency)}`} onClose={busy ? undefined : onClose} wide>
      <form className="stack" onSubmit={submit}>
        {split ? (
          <div className="stack">
            <div className="row"><span className="muted small">Put the whole amount on:</span>
              {["Cash", "Card", "Bank"].map((m) => <button key={m} type="button" className="btn small" onClick={() => allBy(m)}>{m === "Bank" ? "Bank transfer" : m}</button>)}</div>
            <div className="pay-rows">
              {["Cash", "Card", "Bank"].map((m) => (
                <div className="field" key={m}>
                  <label htmlFor={`pay-${m}`}>{m === "Bank" ? "Bank transfer" : m}</label>
                  <input id={`pay-${m}`} type="number" inputMode="decimal" min="0" step="0.01" value={amounts[m] || ""} placeholder="0.00"
                    onChange={(e) => setAmounts({ ...amounts, [m]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="seg three" role="group" aria-label="Payment method">
            {["Cash", "Card", "Bank"].map((m) => <button key={m} type="button" aria-pressed={single === m} onClick={() => setSingle(m)}>{m === "Bank" ? "Bank transfer" : m}</button>)}
          </div>
        )}

        {cashPart > 0 && (
          <>
            <div className="field">
              <label htmlFor="given">Cash received</label>
              <input id="given" className="tender-amount" type="number" inputMode="decimal" min="0" step="0.01" value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} placeholder={fmt(cashPart)} autoFocus />
            </div>
            <div className="quick">{quickCash(cashPart).map((v) => <button type="button" key={v} className="btn" onClick={() => setCashGiven(String(v))}>{fmt(v)}</button>)}</div>
            {change !== null && (
              <div className={`change-box${change < 0 ? " short" : ""}`} aria-live="polite">
                <span>{change < 0 ? "Still to pay in cash" : "Change to give"}</span><span className="amount">{fmt(Math.abs(change))}</span>
              </div>
            )}
          </>
        )}

        {canTrade && (
          <div className="panel pad stack">
            <label className="check"><input type="checkbox" checked={tradeOn} onChange={(e) => setTradeOn(e.target.checked)} /><strong>Trade-in</strong> (customer's old item as part payment)</label>
            {tradeOn && (
              <div className="form-grid">
                <div className="field span-all"><label htmlFor="ti-d">What is it?</label><input id="ti-d" value={trade.description} onChange={(e) => setTrade({ ...trade, description: e.target.value })} placeholder="e.g. Galaxy S10 128GB, screen OK" /></div>
                <div className="field"><label htmlFor="ti-s">Serial / IMEI</label><input id="ti-s" value={trade.serial} onChange={(e) => setTrade({ ...trade, serial: e.target.value })} /></div>
                <div className="field"><label htmlFor="ti-v">Value given ({settings.currency})</label><input id="ti-v" type="number" min="0" value={trade.value} onChange={(e) => setTrade({ ...trade, value: e.target.value })} /></div>
                <div className="field span-all"><label htmlFor="ti-p">Put it into stock as (optional)</label>
                  <select id="ti-p" value={trade.productId} onChange={(e) => setTrade({ ...trade, productId: e.target.value })}>
                    <option value="">Don't add to stock</option>
                    {catalog.map((p) => <option key={p._id} value={p._id}>{nameOf(p)}</option>)}
                  </select></div>
              </div>
            )}
          </div>
        )}

        {canInst && (
          <div className="panel pad stack">
            <label className="check"><input type="checkbox" checked={instOn} onChange={(e) => setInstOn(e.target.checked)} disabled={!customer?._id} />
              <strong>Pay the rest in installments</strong>{!customer?._id && <span className="muted small"> (choose a saved customer first)</span>}</label>
            {instOn && (
              <>
                <p className="small muted">{split ? "The amounts above are the down payment today." : null}</p>
                {!split && (
                  <div className="field"><label htmlFor="down">Down payment today ({single})</label>
                    <input id="down" type="number" min="0" value={amounts.down || ""} onChange={(e) => setAmounts({ ...amounts, down: e.target.value })} /></div>
                )}
                <div className="form-grid">
                  <div className="field"><label htmlFor="im">Months</label>
                    <select id="im" value={inst.months} onChange={(e) => setInst({ ...inst, months: e.target.value })}>{[2, 3, 4, 6, 9, 12, 18, 24, 36].map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                  <div className="field"><label htmlFor="if">Service fee ({settings.currency})</label><input id="if" type="number" min="0" value={inst.fee} onChange={(e) => setInst({ ...inst, fee: e.target.value })} placeholder="0" /></div>
                  <div className="field"><label htmlFor="id">First payment due</label><input id="id" type="date" value={inst.firstDue} onChange={(e) => setInst({ ...inst, firstDue: e.target.value })} /><span className="hint">Default: one month from today</span></div>
                </div>
                {credit > 0 && <div className="change-box"><span>{inst.months} payments of</span><span className="amount">{fmt(monthly)}</span></div>}
              </>
            )}
          </div>
        )}

        <div className="row between">
          <span>{Math.abs(remaining) < 0.005 ? <span className="badge green">Fully paid</span> : remaining > 0 ? <span className="danger-text">Still {fmt(remaining)} to pay</span> : <span className="danger-text">{fmt(-remaining)} more than the total</span>}</span>
          <button className="btn primary big" disabled={busy || !valid}>{busy ? "Saving…" : "Complete sale"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ApprovalModal({ pct, onClose, onApprove }) {
  const { settings } = useSession();
  const [list, setList] = useState(null);
  const [who, setWho] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/users/approvers").then((r) => { setList(r.data); setWho(r.data[0]?._id || ""); }).catch(() => setList([])); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onApprove({ userId: who, pin });
    setBusy(false);
    if (!ok) setPin("");
  };
  return (
    <Modal title="Manager approval needed" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p>This sale has {fmt(pct)}% discount. Cashiers can give up to {settings.maxCashierDiscount}%. A manager or owner must approve it with their PIN.</p>
        {list && !list.length ? <div className="notice red">No manager here has set an approval PIN yet. They can set one under Account.</div> : (
          <>
            <div className="field"><label htmlFor="ap-w">Manager</label>
              <select id="ap-w" value={who} onChange={(e) => setWho(e.target.value)}>{(list || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}</select></div>
            <div className="field"><label htmlFor="ap-p">PIN</label><input id="ap-p" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus autoComplete="off" /></div>
          </>
        )}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !who || !pin}>Approve and complete</button></div>
      </form>
    </Modal>
  );
}

function DoneModal({ sale, settings, onClose }) {
  const [printing, setPrinting] = useState(false);
  const print = () => { setPrinting(true); printNow(); setTimeout(() => setPrinting(false), 1500); };
  return (
    <Modal title={sale.pending ? "Sale saved offline" : "Sale complete"} onClose={onClose}
      footer={<div className="actions"><button className="btn" onClick={print}>Print receipt</button><button className="btn primary" onClick={onClose} autoFocus>New sale</button></div>}>
      <div className="stack">
        {sale.changeGiven != null && sale.changeGiven > 0 && <div className="change-box"><span>Change to give</span><span className="amount">{fmt(sale.changeGiven)}</span></div>}
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, maxHeight: "45vh", overflowY: "auto" }}><Receipt sale={sale} settings={settings} /></div>
      </div>
      <PrintReceipt sale={sale} settings={settings} key={printing ? "p" : "n"} />
    </Modal>
  );
}

function CustomerPicker({ online, onClose, onPick }) {
  const [term, setTerm] = useState("");
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const t = useDebounced(term, 250);
  useEffect(() => {
    if (!online || !t) { setList([]); return; }
    api.get("/customers", { params: { filter: t, limit: 10 } }).then((r) => setList(r.data.customers)).catch(() => setList([]));
  }, [t, online]);
  const create = async () => {
    try { const { data } = await api.post("/customers", { name: term.trim(), contactNumber: phone.trim() }); toast.success("Customer added"); onPick(data); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Modal title="Customer" onClose={onClose}>
      <div className="stack">
        <div className="field"><label htmlFor="cust">Name or phone number</label><input id="cust" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus autoComplete="off" /></div>
        {list.length > 0 && (
          <div className="panel"><table className="data"><tbody>
            {list.map((c) => (
              <tr key={c._id} className="clickable" onClick={() => onPick(c)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onPick(c)}>
                <td><strong>{c.name}</strong></td><td className="muted">{c.contactNumber}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {term.trim() && (adding ? (
          <div className="row">
            <input className="grow" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone number" style={{ width: "auto" }} />
            <button className="btn primary" onClick={create} disabled={!phone.trim()}>Save customer</button>
          </div>
        ) : (
          <div className="row">
            <button className="btn" onClick={() => onPick({ name: term.trim() })}>Use "{term.trim()}" for this sale only</button>
            {online && <button className="btn" onClick={() => setAdding(true)}>Save as new customer</button>}
          </div>
        ))}
        <div className="actions"><button className="btn ghost" onClick={() => onPick(null)}>Walk-in customer</button></div>
      </div>
    </Modal>
  );
}
