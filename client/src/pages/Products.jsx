import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { useForm, clean } from "../lib/form";
import { fmt } from "../lib/money";
import { dateTime } from "../lib/format";
import Modal from "../components/Modal";
import { Empty, Input, Loading, Pager } from "../components/ui";

export default function Products() {
  const { settings, can, multiBranch, location } = useSession();
  const owner = can("owner");
  const showByBranch = multiBranch && owner && !location;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [lowStock, setLowStock] = useState(false);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("name:asc");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);     // product or {} for new
  const [stock, setStock] = useState(null);   // product
  const [history, setHistory] = useState(null);
  const [units, setUnits] = useState(null);
  const dq = useDebounced(q, 300);
  const [sortBy, order] = sort.split(":");
  const list = useApi("/products", { filter: dq || undefined, status, lowStock: lowStock || undefined, category: category || undefined, sortBy, order, page, limit: 25, withStock: showByBranch || undefined });
  const cats = useApi("/products/categories");
  useEffect(() => { setPage(1); }, [dq, status, lowStock, category, sort]);
  const reload = () => { list.reload(); cats.reload(); };

  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><p>{multiBranch ? (location ? `Stock shown for ${location.name}. ` : "Stock shown for all branches together. ") : ""}Every stock change is recorded with who, when and why.</p></div>
        {owner && <button className="btn primary" onClick={() => setEdit({})}>Add product</button>}
      </div>
      <div className="toolbar">
        <div className="field"><label htmlFor="pq">Search</label><input id="pq" type="search" placeholder="Name, barcode or category" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="pc">Category</label>
          <select id="pc" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>{(cats.data || []).map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="ps">Show</label>
          <select id="ps" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">On sale</option><option value="archived">Archived</option><option value="all">All</option>
          </select>
        </div>
        <div className="field"><label htmlFor="po">Sort</label>
          <select id="po" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name:asc">Name</option><option value="quantity:asc">Lowest stock first</option>
            <option value="price:desc">Highest price first</option><option value="createdAt:desc">Newest first</option>
          </select>
        </div>
        <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />Low stock only</label>
      </div>
      <div className="panel">
        {list.loading && !list.data ? <Loading /> : !list.data?.products.length ? (
          <Empty title={dq || lowStock || category ? "No products match" : "No products yet"}>{!dq && !lowStock && !category && "Add your first product to start selling."}</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Product</th><th>Category</th><th>Barcode</th><th className="num">Cost</th><th className="num">Price ({settings.currency})</th><th className="num">{multiBranch ? (location ? `In stock (${location.name})` : "In stock (all)") : "In stock"}</th><th></th></tr></thead>
                <tbody>
                  {list.data.products.map((p) => (
                    <tr key={p._id} className={p.active ? "" : "voided"}>
                      <td><strong>{p.displayName || p.name}</strong>{!p.active && <> <span className="badge">Archived</span></>}
                        {p.trackSerials && <> <span className="badge" title="Each unit has a serial / IMEI">S/N</span></>}
                        {p.warrantyMonths > 0 && <span className="small muted"> {p.warrantyMonths}-month warranty</span>}
                        {p.description && <div className="small muted">{p.description}</div>}</td>
                      <td>{p.category}</td>
                      <td className="small">{p.barcode || <span className="muted">None</span>}</td>
                      <td className="num muted">{p.costPrice != null ? fmt(p.costPrice) : ""}</td>
                      <td className="num"><strong>{fmt(p.price)}</strong></td>
                      <td className="num">
                        {p.quantity <= 0 ? <span className="badge red">0</span> : p.quantity <= p.lowStockThreshold && !showByBranch ? <span className="badge saffron">{p.quantity}</span> : p.quantity}
                        {showByBranch && p.stockByLocation && (
                          <div className="small muted" style={{ whiteSpace: "normal" }}>
                            {p.stockByLocation.map((b) => <span key={b.locationId} style={{ display: "inline-block", marginLeft: 6 }} className={b.quantity <= p.lowStockThreshold && b.type === "store" ? "danger-text" : ""}>{b.name} {b.quantity}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="actions-cell">
                        <button className="btn small" onClick={() => setStock(p)}>Stock</button>{" "}
                        <button className="btn small" onClick={() => setHistory(p)}>History</button>{" "}
                        {p.trackSerials && <><button className="btn small" onClick={() => setUnits(p)}>Units</button>{" "}</>}
                        {owner && <button className="btn small" onClick={() => setEdit(p)}>Edit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} noun="products" />
          </>
        )}
      </div>
      {edit && <ProductForm product={edit} categories={cats.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {stock && <StockForm product={stock} onClose={() => setStock(null)} onSaved={() => { setStock(null); reload(); }} />}
      {history && <StockHistory product={history} onClose={() => setHistory(null)} />}
      {units && <UnitsModal product={units} onClose={() => setUnits(null)} />}
    </>
  );
}

function ProductForm({ product, categories, onClose, onSaved }) {
  const isNew = !product._id;
  const { activeLocations, locationId, multiBranch, has } = useSession();
  const [openingAt, setOpeningAt] = useState(locationId || activeLocations[0]?._id || "");
  const [trackSerials, setTrackSerials] = useState(!!product.trackSerials);
  const [openingSerials, setOpeningSerials] = useState("");
  const serialList = openingSerials.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const f = useForm({
    name: product.name || "", category: product.category || "", price: product.price ?? "", costPrice: product.costPrice ?? "",
    barcode: product.barcode || "", description: product.description || "", lowStockThreshold: product.lowStockThreshold ?? 5,
    quantity: "", model: product.model || "", variant: product.variant || "", warrantyMonths: product.warrantyMonths ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = clean(f.values, ["price", "costPrice", "lowStockThreshold", "quantity", "warrantyMonths"]);
    if (!has("variants")) { delete body.model; delete body.variant; }
    if (!has("warranty")) delete body.warrantyMonths; else if (body.warrantyMonths === null) body.warrantyMonths = 0;
    if (has("serials") && trackSerials !== !!product.trackSerials) body.trackSerials = trackSerials;
    if (isNew && trackSerials) { body.serials = serialList; body.quantity = serialList.length; }
    if (!isNew) delete body.quantity; else if (body.quantity === null) body.quantity = 0;
    if (isNew && multiBranch && body.quantity > 0) body.locationId = openingAt;
    try {
      if (isNew) await api.post("/products", body); else await api.put(`/products/${product._id}`, body);
      toast.success(isNew ? "Product added" : "Product saved");
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const toggleArchive = async () => {
    try {
      if (product.active) await api.delete(`/products/${product._id}`); else await api.put(`/products/${product._id}`, { active: true });
      toast.success(product.active ? "Product archived. It no longer shows on the till." : "Product is on sale again");
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Modal title={isNew ? "Add product" : `Edit ${product.displayName || product.name}`} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <Input label="Name" form={f} name="name" required className="span-all" />
          <div className="field">
            <label htmlFor="cat">Category</label>
            <input id="cat" list="cats" required value={f.values.category} onChange={(e) => f.set("category", e.target.value)} />
            <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <Input label="Barcode" form={f} name="barcode" hint="Scan it here, or leave blank" />
          <Input label="Selling price" form={f} name="price" type="number" min="0" step="0.01" required />
          <Input label="Cost price" form={f} name="costPrice" type="number" min="0" step="0.01" hint="What you pay. Used for profit reports." />
          {has("variants") && <Input label="Model / family (optional)" form={f} name="model" hint="Groups variants, e.g. Galaxy A15" />}
          {has("variants") && <Input label="Variant (optional)" form={f} name="variant" hint="e.g. 128GB Black. Shown after the name." />}
          {has("warranty") && <Input label="Warranty (months)" form={f} name="warrantyMonths" type="number" min="0" max="240" step="1" hint="0 = no warranty. Printed on the receipt." />}
          {has("serials") && (
            <div className="field span-all">
              <label className="check"><input type="checkbox" checked={trackSerials} onChange={(e) => setTrackSerials(e.target.checked)} />Track each unit by serial / IMEI number</label>
              <span className="hint">For phones, laptops, TVs: every unit sold, moved or returned is identified. Accessories usually don't need this.</span>
            </div>
          )}
          {isNew && !trackSerials && <Input label="Opening stock" form={f} name="quantity" type="number" min="0" step="1" hint="How many you have now" />}
          {isNew && trackSerials && (
            <div className="field span-all">
              <label htmlFor="osn">Serial / IMEI numbers of units you have now ({serialList.length})</label>
              <textarea id="osn" value={openingSerials} onChange={(e) => setOpeningSerials(e.target.value)} placeholder="Scan each unit; one per line" rows={4} />
            </div>
          )}
          {isNew && multiBranch && (
            <div className="field"><label htmlFor="oat">Opening stock is at</label>
              <select id="oat" value={openingAt} onChange={(e) => setOpeningAt(e.target.value)}>
                {activeLocations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
              </select>
              <span className="hint">Other branches start at 0. Send stock to them with a transfer.</span>
            </div>
          )}
          <Input label="Warn when stock reaches" form={f} name="lowStockThreshold" type="number" min="0" step="1" />
          <div className="field span-all"><label htmlFor="desc">Description (optional)</label><textarea id="desc" value={f.values.description} onChange={(e) => f.set("description", e.target.value)} /></div>
        </div>
        {!isNew && <p className="muted small">Price changes apply to every branch. To change a stock count, use the Stock button.</p>}
        <div className="row between">
          {!isNew ? <button type="button" className={`btn ${product.active ? "danger" : ""}`} onClick={toggleArchive}>{product.active ? "Archive product" : "Put back on sale"}</button> : <span />}
          <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{isNew ? "Add product" : "Save product"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

function StockForm({ product, onClose, onSaved }) {
  const { user, activeLocations, locationId, multiBranch } = useSession();
  const [type, setType] = useState("receive");
  const pickBranch = multiBranch && user.role === "owner";
  const [branch, setBranch] = useState(locationId || activeLocations[0]?._id || "");
  const branchStock = useApi(pickBranch ? `/products` : null, { locationId: branch, filter: product.barcode || product.name, limit: 50 });
  const current = pickBranch ? (branchStock.data?.products.find((x) => x._id === product._id)?.quantity ?? null) : product.quantity;
  const suppliers = useApi("/suppliers", { limit: 500 });
  const f = useForm({ quantity: "", supplierId: "", unitCost: "", note: "" });
  const [busy, setBusy] = useState(false);
  const { has } = useSession();
  const tracked = has("serials") && product.trackSerials;
  const [snIn, setSnIn] = useState("");
  const [snOut, setSnOut] = useState("");
  const split = (t) => t.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const q = Number(f.values.quantity);
  const after = current == null ? "" : tracked
    ? current + split(snIn).length - (type === "adjust" ? split(snOut).length : 0)
    : type === "receive" ? current + (q || 0) : (f.values.quantity === "" ? current : q);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const base = { type, ...clean(f.values, ["quantity", "unitCost"]), ...(pickBranch ? { locationId: branch } : {}) };
      if (tracked) {
        delete base.quantity;
        if (type === "receive") base.serials = split(snIn);
        else { base.addSerials = split(snIn); base.removeSerials = split(snOut); }
      }
      await api.post(`/products/${product._id}/stock`, base);
      toast.success(`Stock updated: ${product.displayName || product.name} now ${after}`);
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Stock: ${product.displayName || product.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="seg" role="group" aria-label="Kind of stock change">
          <button type="button" aria-pressed={type === "receive"} onClick={() => setType("receive")}>Received delivery</button>
          <button type="button" aria-pressed={type === "adjust"} onClick={() => setType("adjust")}>Stock count</button>
        </div>
        {pickBranch && (
          <div className="field"><label htmlFor="sb">Branch</label>
            <select id="sb" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {activeLocations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <p className="muted">In stock now: <strong>{current ?? "…"}</strong>. After this: <strong>{after}</strong>.</p>
        {tracked ? (
          <div className="form-grid">
            <div className="field span-all"><label htmlFor="sn-in">{type === "receive" ? "Serial / IMEI of each unit received" : "Units found that weren't in the system"} ({split(snIn).length})</label>
              <textarea id="sn-in" rows={4} value={snIn} onChange={(e) => setSnIn(e.target.value)} placeholder="Scan each unit; one per line" autoFocus /></div>
            {type === "adjust" && <div className="field span-all"><label htmlFor="sn-out">Units missing from the shelf ({split(snOut).length})</label>
              <textarea id="sn-out" rows={3} value={snOut} onChange={(e) => setSnOut(e.target.value)} placeholder="Serials that couldn't be found" /></div>}
            {type === "receive" && <Input label="Cost per unit (optional)" form={f} name="unitCost" type="number" min="0" step="0.01" />}
            {type === "receive" && (
              <div className="field"><label htmlFor="sup2">Supplier (optional)</label>
                <select id="sup2" value={f.values.supplierId} onChange={(e) => f.set("supplierId", e.target.value)}>
                  <option value="">Not recorded</option>{(suppliers.data?.suppliers || []).map((x) => <option key={x._id} value={x._id}>{x.name} ({x.company})</option>)}
                </select></div>
            )}
            <Input label={type === "adjust" ? "Reason" : "Note (optional)"} form={f} name="note" required={type === "adjust"} className="span-all" />
          </div>
        ) : type === "receive" ? (
          <div className="form-grid">
            <Input label="Units received" form={f} name="quantity" type="number" min="1" step="1" required />
            <Input label="Cost per unit (optional)" form={f} name="unitCost" type="number" min="0" step="0.01" hint="Updates the product's cost price" />
            <div className="field span-all"><label htmlFor="sup">Supplier (optional)</label>
              <select id="sup" value={f.values.supplierId} onChange={(e) => f.set("supplierId", e.target.value)}>
                <option value="">Not recorded</option>{(suppliers.data?.suppliers || []).map((s) => <option key={s._id} value={s._id}>{s.name} ({s.company})</option>)}
              </select>
            </div>
            <Input label="Note (optional)" form={f} name="note" className="span-all" placeholder="e.g. Invoice number from supplier" />
          </div>
        ) : (
          <div className="form-grid">
            <Input label="Units actually on the shelf" form={f} name="quantity" type="number" min="0" step="1" required />
            <Input label="Reason" form={f} name="note" required placeholder="e.g. Monthly stock-take, 2 damaged" />
          </div>
        )}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save stock change</button></div>
      </form>
    </Modal>
  );
}

const REASONS = {
  repair_part: "Used in a repair", repair_part_back: "Repair part returned", claim_out: "Sent to supplier (claim)",
  claim_back: "Back from supplier", trade_in: "Taken as trade-in", write_off: "Written off",
  initial: "Opening stock", sale: "Sold", void: "Sale voided", return: "Returned by customer", receive: "Delivery received",
  adjust: "Stock count", offline_shortfall: "Sold offline beyond stock",
  transfer_out: "Sent to another branch", transfer_in: "Received from another branch",
  transfer_short: "Missing from a transfer", transfer_cancel: "Transfer cancelled",
};

function StockHistory({ product, onClose }) {
  const { settings, multiBranch } = useSession();
  const { data, loading } = useApi(`/products/${product._id}/movements`);
  return (
    <Modal title={`History: ${product.displayName || product.name}`} onClose={onClose} wide>
      {loading ? <Loading /> : !data?.length ? <Empty title="No stock changes yet" /> : (
        <div className="table-wrap" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <table className="data">
            <thead><tr><th>When</th>{multiBranch && <th>Branch</th>}<th>What</th><th className="num">Change</th><th className="num">Stock after</th><th>By</th><th>Details</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m._id}>
                  <td>{dateTime(m.createdAt, settings.timezone)}</td>
                  {multiBranch && <td>{m.locationName}</td>}
                  <td>{["offline_shortfall", "transfer_short"].includes(m.reason) ? <span className="badge saffron">{REASONS[m.reason]}</span> : REASONS[m.reason] || m.reason}</td>
                  <td className="num">{m.change > 0 ? `+${m.change}` : m.change}</td>
                  <td className="num">{m.quantityAfter}</td>
                  <td>{m.userName}</td>
                  <td className="small">{[m.invoiceNumber, m.returnNumber, m.transferNumber, m.supplierName, m.unitCost != null ? `cost ${fmt(m.unitCost)}` : null, m.note].filter(Boolean).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

const UNIT_STATUS = { in_stock: "In stock", in_transit: "On the way", sold: "Sold", defective: "Faulty", with_supplier: "With supplier", written_off: "Written off", missing: "Missing", in_repair: "In repair" };

function UnitsModal({ product, onClose }) {
  const [all, setAll] = useState(false);
  const { data, loading } = useApi(`/products/${product._id}/serials`, { status: all ? "all" : "in_stock" });
  return (
    <Modal title={`Units: ${product.displayName || product.name}`} onClose={onClose} wide>
      <div className="stack">
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show sold and other units too</label>
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No units" /> : (
          <div className="table-wrap" style={{ maxHeight: "55vh", overflowY: "auto" }}>
            <table className="data">
              <thead><tr><th>Serial / IMEI</th><th>Status</th><th>Branch</th><th>Warranty until</th></tr></thead>
              <tbody>{data.map((u) => <tr key={u._id}><td><strong>{u.serial}</strong></td><td>{UNIT_STATUS[u.status] || u.status}</td><td>{u.locationName || ""}</td><td>{u.warrantyUntil || ""}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
