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
  const { settings } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [lowStock, setLowStock] = useState(false);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("name:asc");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);     // product or {} for new
  const [stock, setStock] = useState(null);   // product
  const [history, setHistory] = useState(null);
  const dq = useDebounced(q, 300);
  const [sortBy, order] = sort.split(":");
  const list = useApi("/products", { filter: dq || undefined, status, lowStock: lowStock || undefined, category: category || undefined, sortBy, order, page, limit: 25 });
  const cats = useApi("/products/categories");
  useEffect(() => { setPage(1); }, [dq, status, lowStock, category, sort]);
  const reload = () => { list.reload(); cats.reload(); };

  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><p>Prices, barcodes and stock. Stock changes are recorded with who, when and why.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>Add product</button>
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
                <thead><tr><th>Product</th><th>Category</th><th>Barcode</th><th className="num">Cost</th><th className="num">Price ({settings.currency})</th><th className="num">In stock</th><th></th></tr></thead>
                <tbody>
                  {list.data.products.map((p) => (
                    <tr key={p._id} className={p.active ? "" : "voided"}>
                      <td><strong>{p.name}</strong>{!p.active && <> <span className="badge">Archived</span></>}{p.description && <div className="small muted">{p.description}</div>}</td>
                      <td>{p.category}</td>
                      <td className="small">{p.barcode || <span className="muted">None</span>}</td>
                      <td className="num muted">{p.costPrice != null ? fmt(p.costPrice) : ""}</td>
                      <td className="num"><strong>{fmt(p.price)}</strong></td>
                      <td className="num">
                        {p.quantity <= 0 ? <span className="badge red">0</span> : p.quantity <= p.lowStockThreshold ? <span className="badge saffron">{p.quantity}</span> : p.quantity}
                      </td>
                      <td className="actions-cell">
                        <button className="btn small" onClick={() => setStock(p)}>Stock</button>{" "}
                        <button className="btn small" onClick={() => setHistory(p)}>History</button>{" "}
                        <button className="btn small" onClick={() => setEdit(p)}>Edit</button>
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
    </>
  );
}

function ProductForm({ product, categories, onClose, onSaved }) {
  const isNew = !product._id;
  const f = useForm({
    name: product.name || "", category: product.category || "", price: product.price ?? "", costPrice: product.costPrice ?? "",
    barcode: product.barcode || "", description: product.description || "", lowStockThreshold: product.lowStockThreshold ?? 5,
    quantity: "",
  });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = clean(f.values, ["price", "costPrice", "lowStockThreshold", "quantity"]);
    if (!isNew) delete body.quantity; else if (body.quantity === null) body.quantity = 0;
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
    <Modal title={isNew ? "Add product" : `Edit ${product.name}`} onClose={onClose} wide>
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
          {isNew && <Input label="Opening stock" form={f} name="quantity" type="number" min="0" step="1" hint="How many you have now" />}
          <Input label="Warn when stock reaches" form={f} name="lowStockThreshold" type="number" min="0" step="1" />
          <div className="field span-all"><label htmlFor="desc">Description (optional)</label><textarea id="desc" value={f.values.description} onChange={(e) => f.set("description", e.target.value)} /></div>
        </div>
        {!isNew && <p className="muted small">To change the stock count, use the Stock button. Every change is kept in the product's history.</p>}
        <div className="row between">
          {!isNew ? <button type="button" className={`btn ${product.active ? "danger" : ""}`} onClick={toggleArchive}>{product.active ? "Archive product" : "Put back on sale"}</button> : <span />}
          <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{isNew ? "Add product" : "Save product"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

function StockForm({ product, onClose, onSaved }) {
  const [type, setType] = useState("receive");
  const suppliers = useApi("/suppliers", { limit: 500 });
  const f = useForm({ quantity: "", supplierId: "", unitCost: "", note: "" });
  const [busy, setBusy] = useState(false);
  const q = Number(f.values.quantity);
  const after = type === "receive" ? product.quantity + (q || 0) : (f.values.quantity === "" ? product.quantity : q);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/products/${product._id}/stock`, { type, ...clean(f.values, ["quantity", "unitCost"]) });
      toast.success(`Stock updated: ${product.name} now ${after}`);
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Stock: ${product.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="seg" role="group" aria-label="Kind of stock change">
          <button type="button" aria-pressed={type === "receive"} onClick={() => setType("receive")}>Received delivery</button>
          <button type="button" aria-pressed={type === "adjust"} onClick={() => setType("adjust")}>Stock count</button>
        </div>
        <p className="muted">In stock now: <strong>{product.quantity}</strong>. After this: <strong>{after}</strong>.</p>
        {type === "receive" ? (
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

const REASONS = { initial: "Opening stock", sale: "Sold", void: "Sale voided", return: "Returned by customer", receive: "Delivery received", adjust: "Stock count", offline_shortfall: "Sold offline beyond stock" };

function StockHistory({ product, onClose }) {
  const { settings } = useSession();
  const { data, loading } = useApi(`/products/${product._id}/movements`);
  return (
    <Modal title={`History: ${product.name}`} onClose={onClose} wide>
      {loading ? <Loading /> : !data?.length ? <Empty title="No stock changes yet" /> : (
        <div className="table-wrap" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <table className="data">
            <thead><tr><th>When</th><th>What</th><th className="num">Change</th><th className="num">Stock after</th><th>By</th><th>Details</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m._id}>
                  <td>{dateTime(m.createdAt, settings.timezone)}</td>
                  <td>{m.reason === "offline_shortfall" ? <span className="badge saffron">{REASONS[m.reason]}</span> : REASONS[m.reason] || m.reason}</td>
                  <td className="num">{m.change > 0 ? `+${m.change}` : m.change}</td>
                  <td className="num">{m.quantityAfter}</td>
                  <td>{m.userName}</td>
                  <td className="small">{[m.invoiceNumber, m.returnNumber, m.supplierName, m.unitCost != null ? `cost ${fmt(m.unitCost)}` : null, m.note].filter(Boolean).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
