import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage, isConnectionError } from "../lib/api";
import { useSession } from "../lib/session";
import { computeTotals, fmt, money, quickCash, round2 } from "../lib/money";
import { load, save } from "../lib/storage";
import { enqueue } from "../lib/offline";
import { uuid } from "../lib/uuid";
import { useDebounced } from "../lib/hooks";
import Modal from "../components/Modal";
import { Receipt, PrintReceipt, printNow } from "../components/Receipt";
import { OpenShiftForm } from "./Shifts";

const CATALOG_KEY = "pos.catalog";
const CART_KEY = "pos.cart";

export default function Till() {
  const { user, settings, shift, online, setOnline, refreshShift, can, multiBranch, location, locationId } = useSession();
  // The till sells from the branch of the open shift (or, before a shift, the chosen branch).
  const tillLocationId = shift?.location?._id || locationId || null;
  const tillLocation = shift?.location || location;
  const catalogKey = `${CATALOG_KEY}.${tillLocationId || "default"}`;
  const [catalog, setCatalog] = useState(() => load(catalogKey, []));
  const [catalogState, setCatalogState] = useState("loading");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const saved = load(CART_KEY, null);
  const [cart, setCart] = useState(saved?.userId === user._id ? saved.cart : []);
  const [discount, setDiscount] = useState(saved?.userId === user._id ? saved.discount : 0);
  const [taxRate, setTaxRate] = useState(saved?.userId === user._id ? saved.taxRate : settings.defaultTaxRate || 0);
  const [customer, setCustomer] = useState(saved?.userId === user._id ? saved.customer : null);
  const [paying, setPaying] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [done, setDone] = useState(null);
  const searchRef = useRef(null);

  // Keep an unfinished sale if the page is refreshed.
  useEffect(() => { save(CART_KEY, { userId: user._id, cart, discount, taxRate, customer }); }, [user._id, cart, discount, taxRate, customer]);

  const loadCatalog = useCallback(async () => {
    try {
      const { data } = await api.get("/products", { params: { limit: 5000, status: "active", locationId: tillLocationId || undefined } });
      setCatalog(data.products);
      save(catalogKey, data.products);
      setCatalogState("ok");
      setOnline(true);
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
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.barcode || "").toLowerCase() === q || (p.barcode || "").toLowerCase().startsWith(q));
    return list.slice(0, 60);
  }, [catalog, category, q]);

  const inCart = (id) => cart.find((l) => l.product === id)?.quantity || 0;

  const add = (p, qty = 1) => {
    if (!p) return;
    const stock = byId.get(p._id)?.quantity ?? p.quantity;
    if (inCart(p._id) + qty > stock) {
      if (online) { toast.warn(`Only ${stock} of "${p.name}" in stock`); return; }
      toast.warn(`Stock shows ${stock} of "${p.name}". Selling anyway while offline.`);
    }
    setCart((c) => {
      const ex = c.find((l) => l.product === p._id);
      if (ex) return c.map((l) => (l.product === p._id ? { ...l, quantity: l.quantity + qty } : l));
      return [...c, { product: p._id, name: p.name, price: p.price, quantity: qty }];
    });
  };

  const setQty = (id, qty) => {
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const stock = byId.get(id)?.quantity ?? Infinity;
    if (n > stock && online) { toast.warn(`Only ${stock} in stock`); }
    setCart((c) => c.map((l) => (l.product === id ? { ...l, quantity: online ? Math.min(n, Math.max(stock, 1)) : n } : l)));
  };

  const onSearchKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = search.trim();
    if (!code) return;
    const exact = catalog.find((p) => p.barcode && p.barcode === code);
    if (exact) { add(exact); setSearch(""); return; }
    if (results.length === 1) { add(results[0]); setSearch(""); return; }
    if (!results.length) toast.error(`Nothing matches "${code}"`);
  };

  const totals = computeTotals(cart, Number(discount) || 0, Number(taxRate) || 0);
  const maxDisc = can("manager") ? 100 : settings.maxCashierDiscount;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F9" && cart.length && !paying && !done) { e.preventDefault(); setPaying(true); }
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length, paying, done]);

  const clearSale = () => {
    setCart([]); setDiscount(0); setTaxRate(settings.defaultTaxRate || 0); setCustomer(null);
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  // Called by the tender dialog.
  const complete = async ({ paymentMethod, amountTendered }) => {
    const clientRef = uuid();
    const payload = {
      clientRef,
      items: cart.map((l) => ({ product: l.product, quantity: l.quantity })),
      customer: customer?._id || null,
      customerName: customer?._id ? "" : (customer?.name || ""),
      paymentMethod,
      discount: Number(discount) || 0,
      taxRate: Number(taxRate) || 0,
      amountTendered: paymentMethod === "Cash" && amountTendered !== "" ? Number(amountTendered) : null,
    };
    try {
      const { data } = await api.post("/sales", payload);
      setPaying(false);
      setDone({ sale: data.sale });
      clearSale();
      loadCatalog();
    } catch (err) {
      if (isConnectionError(err)) {
        // Save offline: the customer has paid, so the sale must not be lost.
        const createdAt = new Date().toISOString();
        const offlinePayload = {
          ...payload, offline: true, createdAt, shiftId: shift?._id || null,
          items: cart.map((l) => ({ product: l.product, quantity: l.quantity, price: l.price, name: l.name })),
        };
        const receipt = {
          pending: true, invoiceNumber: `OFF-${clientRef.slice(0, 8).toUpperCase()}`, date: createdAt,
          cashier: user, customerName: customer?.name || "Walk-in Customer", paymentMethod, location: tillLocation,
          items: cart.map((l) => ({ ...l, total: round2(l.price * l.quantity) })),
          discount: payload.discount, taxRate: payload.taxRate, ...totals,
          amountTendered: payload.amountTendered,
          changeGiven: payload.amountTendered != null ? round2(payload.amountTendered - totals.totalAmount) : null,
        };
        try {
          enqueue({ clientRef, userId: user._id, payload: offlinePayload, receipt, queuedAt: createdAt });
        } catch (e) {
          toast.error(e.message);
          return;
        }
        // Reduce the cached stock so the till stays roughly right while offline.
        const next = catalog.map((p) => {
          const l = cart.find((x) => x.product === p._id);
          return l ? { ...p, quantity: Math.max(0, p.quantity - l.quantity) } : p;
        });
        setCatalog(next); save(catalogKey, next);
        setOnline(false);
        setPaying(false);
        setDone({ sale: receipt });
        clearSale();
        toast.warn("No connection. Sale saved on this till and will upload automatically.");
        return;
      }
      const code = err.response?.data?.code;
      if (code === "SHIFT_REQUIRED") { refreshShift().catch(() => {}); setPaying(false); }
      if (err.response?.status === 409) loadCatalog();
      toast.error(errorMessage(err, "Sale failed"));
    }
  };

  if (!shift && online && user.role === "owner" && multiBranch && (!location || location.type !== "store")) {
    return (
      <>
        <div className="page-head"><div><h1>Till</h1><p>Choose which shop you're selling in.</p></div></div>
        <div className="notice">Pick a shop in the branch menu at the top of the screen, then open your shift.</div>
      </>
    );
  }

  if (!shift && online) {
    return (
      <>
        <div className="page-head"><div><h1>Till</h1><p>Open your shift to start selling{multiBranch && tillLocation ? ` at ${tillLocation.name}` : ""}.</p></div></div>
        <div className="panel pad" style={{ maxWidth: 460 }}>
          <OpenShiftForm onOpened={() => searchRef.current?.focus()} />
        </div>
      </>
    );
  }

  return (
    <>
      {catalogState === "offline" && (
        <div className="notice">You're offline. Selling from the saved product list; sales will upload when the connection returns.</div>
      )}
      {catalogState === "error" && <div className="notice red">Couldn't load products. <button className="btn small" onClick={loadCatalog}>Try again</button></div>}
      {!shift && !online && <div className="notice">No shift is open on this till. Offline sales will still be saved and flagged for the manager.</div>}

      <div className="till">
        <section aria-label="Products">
          <div className="till-search">
            <label htmlFor="till-search" className="visually-hidden">Scan a barcode or search products</label>
            <input
              id="till-search" ref={searchRef} type="search" autoComplete="off"
              placeholder="Scan barcode or search (F2)"
              value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey}
            />
          </div>
          {categories.length > 1 && (
            <div className="chips" role="group" aria-label="Categories">
              <button className="chip" aria-pressed={!category} onClick={() => setCategory("")}>All</button>
              {categories.map((c) => <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c === category ? "" : c)}>{c}</button>)}
            </div>
          )}
          {!catalog.length && catalogState !== "loading" ? (
            <div className="panel empty"><strong>No products yet</strong>{can("manager") ? "Add products on the Products page." : "Ask a manager to add products."}</div>
          ) : (
            <div className="tiles" style={{ marginTop: categories.length > 1 ? 0 : 12 }}>
              {results.map((p) => {
                const left = p.quantity - inCart(p._id);
                return (
                  <button key={p._id} className="tile" onClick={() => add(p)} disabled={online && left <= 0}>
                    <span className="name">{p.name}</span>
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
                <span className="lsum">{fmt(l.price * l.quantity)}</span>
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
              </div>
            ))}
          </div>
          {cart.length > 0 && (
            <div className="tape-extra">
              <div className="field">
                <label htmlFor="disc">Discount %</label>
                <input id="disc" type="number" min="0" max={maxDisc} step="0.5" value={discount}
                  onChange={(e) => setDiscount(Math.min(maxDisc, Math.max(0, Number(e.target.value) || 0)))} />
              </div>
              <div className="field">
                <label htmlFor="tax">Tax %</label>
                <input id="tax" type="number" min="0" max="100" step="0.5" value={taxRate}
                  onChange={(e) => setTaxRate(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
              </div>
            </div>
          )}
          <div className="tape-sums">
            <span className="k">Subtotal</span><span className="v">{fmt(totals.subtotal)}</span>
            {totals.discountAmount > 0 && <><span className="k">Discount</span><span className="v">−{fmt(totals.discountAmount)}</span></>}
            {totals.taxAmount > 0 && <><span className="k">Tax</span><span className="v">{fmt(totals.taxAmount)}</span></>}
          </div>
          <div className="tape-total">
            <span>Total {settings.currency}</span>
            <span className="amount">{fmt(totals.totalAmount)}</span>
          </div>
          <div className="tape-pay">
            <button className="btn primary big block" disabled={!cart.length} onClick={() => setPaying(true)}>Pay (F9)</button>
          </div>
        </aside>
      </div>

      {paying && <TenderModal total={totals.totalAmount} currency={settings.currency} onClose={() => setPaying(false)} onComplete={complete} />}
      {custOpen && <CustomerPicker online={online} onClose={() => setCustOpen(false)} onPick={(c) => { setCustomer(c); setCustOpen(false); }} />}
      {done && <DoneModal sale={done.sale} settings={settings} onClose={() => { setDone(null); setTimeout(() => searchRef.current?.focus(), 0); }} />}
    </>
  );
}

function TenderModal({ total, currency, onClose, onComplete }) {
  const [method, setMethod] = useState("Cash");
  const [given, setGiven] = useState("");
  const [busy, setBusy] = useState(false);
  const givenNum = given === "" ? null : Number(given);
  const change = givenNum == null ? null : round2(givenNum - total);
  const short = method === "Cash" && givenNum != null && givenNum < total;

  const submit = async (e) => {
    e?.preventDefault();
    if (short || busy) return;
    setBusy(true);
    try { await onComplete({ paymentMethod: method, amountTendered: method === "Cash" ? given : "" }); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Take payment: ${money(total, currency)}`} onClose={busy ? undefined : onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="seg" role="group" aria-label="Payment method">
          <button type="button" aria-pressed={method === "Cash"} onClick={() => setMethod("Cash")}>Cash</button>
          <button type="button" aria-pressed={method === "Card"} onClick={() => setMethod("Card")}>Card</button>
        </div>
        {method === "Cash" ? (
          <>
            <div className="field">
              <label htmlFor="given">Cash received</label>
              <input id="given" className="tender-amount" type="number" inputMode="decimal" min="0" step="0.01"
                value={given} onChange={(e) => setGiven(e.target.value)} placeholder={fmt(total)} autoFocus />
            </div>
            <div className="quick">
              {quickCash(total).map((v) => <button type="button" key={v} className="btn" onClick={() => setGiven(String(v))}>{fmt(v)}</button>)}
            </div>
            {change != null && (
              <div className={`change-box${short ? " short" : ""}`} aria-live="polite">
                <span>{short ? "Still to pay" : "Change to give"}</span>
                <span className="amount">{fmt(Math.abs(change))}</span>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Charge {money(total, currency)} on the card machine, then confirm here once it's approved.</p>
        )}
        <button className="btn primary big block" disabled={busy || short}>{busy ? "Saving…" : "Complete sale"}</button>
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
        {sale.changeGiven != null && sale.changeGiven > 0 && (
          <div className="change-box"><span>Change to give</span><span className="amount">{fmt(sale.changeGiven)}</span></div>
        )}
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, maxHeight: "45vh", overflowY: "auto" }}>
          <Receipt sale={sale} settings={settings} />
        </div>
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
    try {
      const { data } = await api.post("/customers", { name: term.trim(), contactNumber: phone.trim() });
      toast.success("Customer added");
      onPick(data);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <Modal title="Customer" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label htmlFor="cust">Name or phone number</label>
          <input id="cust" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus autoComplete="off" />
        </div>
        {list.length > 0 && (
          <div className="panel">
            <table className="data"><tbody>
              {list.map((c) => (
                <tr key={c._id} className="clickable" onClick={() => onPick(c)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onPick(c)}>
                  <td><strong>{c.name}</strong></td><td className="muted">{c.contactNumber}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
        {term.trim() && (
          <div className="stack">
            {adding ? (
              <div className="row">
                <input className="grow" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone number" style={{ width: "auto" }} />
                <button className="btn primary" onClick={create} disabled={!phone.trim()}>Save customer</button>
              </div>
            ) : (
              <div className="row">
                <button className="btn" onClick={() => onPick({ name: term.trim() })}>Use "{term.trim()}" for this sale only</button>
                {online && <button className="btn" onClick={() => setAdding(true)}>Save as new customer</button>}
              </div>
            )}
          </div>
        )}
        <div className="actions"><button className="btn ghost" onClick={() => onPick(null)}>Walk-in customer</button></div>
      </div>
    </Modal>
  );
}
