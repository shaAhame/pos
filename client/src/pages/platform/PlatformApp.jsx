import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../../lib/api";
import { papi, getPlatformToken, setPlatformToken } from "../../lib/platformApi";
import { useForm } from "../../lib/form";
import { fmt } from "../../lib/money";
import { Input, Select, Empty, Loading } from "../../components/ui";
import Modal from "../../components/Modal";

const TYPES = [
  { value: "grocery", label: "Grocery / supermarket" },
  { value: "electronics", label: "Electronics / mobile phones" },
  { value: "general", label: "General retail" },
];
const typeName = (t) => TYPES.find((x) => x.value === t)?.label || t;
const dateShort = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Never");

export default function PlatformApp() {
  const [token, setToken] = useState(getPlatformToken());
  const [admin, setAdmin] = useState(null);
  useEffect(() => {
    if (!token) return;
    papi.get("/me").then((r) => setAdmin(r.data)).catch(() => { setPlatformToken(null); setToken(null); });
  }, [token]);
  const signIn = (t, a) => { setPlatformToken(t); setToken(t); setAdmin(a); };
  const signOut = () => { setPlatformToken(null); setToken(null); setAdmin(null); };

  if (!token) return <PlatformLogin onSignedIn={signIn} />;
  if (!admin) return <div className="empty">Loading…</div>;
  return (
    <div className="platform">
      <header className="topbar">
        <span className="shop">MacQuad Platform</span>
        <span className="spacer" />
        <span className="small" style={{ opacity: .8 }}>{admin.name}</span>
        <button className="btn ghost small" onClick={signOut}>Log out</button>
      </header>
      <main className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <Businesses />
        <Admins />
      </main>
    </div>
  );
}

function PlatformLogin({ onSignedIn }) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const f = useForm({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/auth/status").then((r) => setNeedsSetup(r.data.needsPlatformSetup)).catch(() => {}); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = needsSetup ? await papi.post("/setup", f.values) : await papi.post("/login", { email: f.values.email, password: f.values.password });
      onSignedIn(data.token, data.admin);
    } catch (err) { setError(errorMessage(err, "Couldn't log in")); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div className="brand"><img src="/favicon.svg" alt="" /><strong>MacQuad Platform</strong></div>
        <div>
          <h1>{needsSetup ? "Set up the platform" : "Platform login"}</h1>
          <p className="muted">{needsSetup ? "Create the first MacQuad admin account. This only happens once." : "For MacQuad staff who manage client businesses."}</p>
        </div>
        {needsSetup && <Input label="Your name" form={f} name="name" required />}
        <Input label="Email" form={f} name="email" type="email" autoComplete="username" required />
        <Input label="Password" form={f} name="password" type="password" autoComplete={needsSetup ? "new-password" : "current-password"} required
          hint={needsSetup ? "At least 8 characters, with upper and lower case letters and a number." : undefined} />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn primary big" disabled={busy}>{needsSetup ? "Create admin account" : "Log in"}</button>
        <a href="/login" className="small">Shop staff log in here</a>
      </form>
    </div>
  );
}

function Businesses() {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const load = () => papi.get("/businesses").then((r) => setList(r.data)).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, []);
  const active = list?.filter((b) => b.status === "active").length || 0;
  return (
    <>
      <div className="page-head">
        <div><h1>Client businesses</h1><p>{list ? `${active} active of ${list.length}` : ""}. Each business only ever sees its own data.</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>Add business</button>
      </div>
      <div className="panel">
        {!list ? <Loading /> : !list.length ? <Empty title="No clients yet">Add your first client business.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Business</th><th>Type</th><th>Status</th><th className="num">Branches</th><th className="num">Staff</th><th className="num">Sales (30 days)</th><th className="num">Revenue (30 days)</th><th>Last sale</th></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b._id} className={`clickable${b.status === "suspended" ? " voided" : ""}`} tabIndex={0} onClick={() => setOpen(b)} onKeyDown={(e) => e.key === "Enter" && setOpen(b)}>
                    <td><strong>{b.name}</strong><div className="small muted">{b.contactName || b.owners[0]?.email}</div></td>
                    <td>{typeName(b.type)}</td>
                    <td>{b.status === "active" ? <span className="badge green">Active</span> : <span className="badge red">Suspended</span>}</td>
                    <td className="num">{b.branchCount}</td>
                    <td className="num">{b.userCount}</td>
                    <td className="num">{b.sales30d}</td>
                    <td className="num">{fmt(b.revenue30d)}</td>
                    <td>{dateShort(b.lastSaleAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <AddBusiness onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {open && <BusinessDetail id={open._id} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function AddBusiness({ onClose, onDone }) {
  const f = useForm({ name: "", type: "grocery", contactName: "", contactPhone: "", contactEmail: "", branchName: "Main store", ownerFirst: "", ownerLast: "", ownerEmail: "", ownerPassword: "" });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const v = f.values;
    try {
      await papi.post("/businesses", {
        name: v.name, type: v.type, contactName: v.contactName, contactPhone: v.contactPhone, contactEmail: v.contactEmail, branchName: v.branchName || "Main store",
        owner: { firstName: v.ownerFirst, lastName: v.ownerLast, email: v.ownerEmail, password: v.ownerPassword },
      });
      toast.success(`${v.name} created. Give the owner their email and password.`);
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add business" onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <Input label="Business name" form={f} name="name" required />
          <Select label="Type" form={f} name="type" options={TYPES} hint="Sets the starting features. You can switch features on or off afterwards." />
          <Input label="Contact person" form={f} name="contactName" />
          <Input label="Contact phone" form={f} name="contactPhone" />
          <Input label="Contact email" form={f} name="contactEmail" type="email" />
          <Input label="First branch name" form={f} name="branchName" />
        </div>
        <h3>Owner login</h3>
        <div className="form-grid">
          <Input label="First name" form={f} name="ownerFirst" required />
          <Input label="Last name" form={f} name="ownerLast" required />
          <Input label="Email (used to log in)" form={f} name="ownerEmail" type="email" required />
          <Input label="Temporary password" form={f} name="ownerPassword" type="password" required autoComplete="new-password" hint="At least 8 characters, upper and lower case and a number. They can change it later." />
        </div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Create business</button></div>
      </form>
    </Modal>
  );
}

function BusinessDetail({ id, onClose, onChanged }) {
  const [b, setB] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [reset, setReset] = useState(null);
  const load = () => papi.get(`/businesses/${id}`).then((r) => setB(r.data));
  useEffect(() => { load(); papi.get("/features").then((r) => setCatalog(r.data)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = async (body, msg) => {
    try { const { data } = await papi.put(`/businesses/${id}`, body); setB(data); onChanged(); if (msg) toast.success(msg); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  if (!b || !catalog) return <Modal title="Business" onClose={onClose}><Loading /></Modal>;
  const groups = [...new Set(Object.values(catalog.features).map((x) => x.group))];
  return (
    <Modal title={b.name} onClose={onClose} wide>
      <div className="stack">
        <div className="row between">
          <div className="row">{b.status === "active" ? <span className="badge green">Active</span> : <span className="badge red">Suspended</span>}<span className="muted">{typeName(b.type)}, client since {dateShort(b.createdAt)}</span></div>
          {b.status === "active"
            ? <button className="btn danger" onClick={() => window.confirm(`Suspend ${b.name}? Their staff are logged out at once and can't log in until you reactivate.`) && update({ status: "suspended" }, "Business suspended")}>Suspend</button>
            : <button className="btn primary" onClick={() => update({ status: "active" }, "Business reactivated")}>Reactivate</button>}
        </div>
        <div className="kpis">
          <div className="kpi"><div className="k">Branches</div><div className="v">{b.branchCount}</div></div>
          <div className="kpi"><div className="k">Active staff</div><div className="v">{b.userCount}</div></div>
          <div className="kpi"><div className="k">Sales, 30 days</div><div className="v">{b.sales30d}</div><div className="s">{fmt(b.revenue30d)}</div></div>
          <div className="kpi"><div className="k">Last sale</div><div className="v" style={{ fontSize: "var(--step-1)" }}>{dateShort(b.lastSaleAt)}</div></div>
        </div>
        <h3>Features</h3>
        <p className="muted small">Switch on what this client needs. Changes apply the next time their staff load a page.</p>
        <div className="feature-grid">
          {groups.map((g) => (
            <fieldset key={g} className="panel pad">
              <legend className="small muted">{g}</legend>
              {Object.entries(catalog.features).filter(([, v]) => v.group === g).map(([k, v]) => (
                <label key={k} className="check" style={{ padding: "6px 0" }}>
                  <input type="checkbox" checked={!!b.features[k]} onChange={(e) => update({ features: { [k]: e.target.checked } }, `${v.label}: ${e.target.checked ? "on" : "off"}`)} />
                  {v.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <h3>Owner logins</h3>
        {b.owners.map((o) => (
          <div key={o._id} className="row between">
            <span><strong>{o.name}</strong> <span className="muted">{o.email}</span>{!o.active && <span className="badge"> Disabled</span>}</span>
            <button className="btn small" onClick={() => setReset(o)}>Reset password</button>
          </div>
        ))}
        <DetailsForm b={b} onSave={(v) => update(v, "Saved")} />
      </div>
      {reset && <ResetPassword business={b} owner={reset} onClose={() => setReset(null)} />}
    </Modal>
  );
}

function DetailsForm({ b, onSave }) {
  const f = useForm({ name: b.name, type: b.type, plan: b.plan, contactName: b.contactName, contactPhone: b.contactPhone, contactEmail: b.contactEmail, notes: b.notes });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(f.values); }}>
      <h3>Details</h3>
      <div className="form-grid">
        <Input label="Business name" form={f} name="name" required />
        <Select label="Type" form={f} name="type" options={TYPES} />
        <Input label="Plan" form={f} name="plan" />
        <Input label="Contact person" form={f} name="contactName" />
        <Input label="Contact phone" form={f} name="contactPhone" />
        <Input label="Contact email" form={f} name="contactEmail" type="email" />
        <div className="field span-all"><label htmlFor="bn">Notes (only MacQuad sees these)</label><textarea id="bn" value={f.values.notes} onChange={(e) => f.set("notes", e.target.value)} /></div>
      </div>
      <div className="actions"><button className="btn primary">Save details</button></div>
    </form>
  );
}

function ResetPassword({ business, owner, onClose }) {
  const [pw, setPw] = useState("");
  const save = async (e) => {
    e.preventDefault();
    try { await papi.post(`/businesses/${business._id}/reset-password`, { userId: owner._id, password: pw }); toast.success(`New password set for ${owner.email}`); onClose(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Modal title={`Reset password for ${owner.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field"><label htmlFor="np">New password</label><input id="np" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" /><span className="hint">Tell the owner this password; they can change it under Account.</span></div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Set password</button></div>
      </form>
    </Modal>
  );
}

function Admins() {
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const f = useForm({ name: "", email: "", password: "" });
  const load = () => papi.get("/admins").then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  const save = async (e) => {
    e.preventDefault();
    try { await papi.post("/admins", f.values); toast.success("Admin added"); setAdding(false); f.reset(); load(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <>
      <div className="page-head" style={{ marginTop: 32 }}><div><h2>MacQuad admins</h2><p className="muted">People who can manage client businesses.</p></div>
        <button className="btn" onClick={() => setAdding(true)}>Add admin</button></div>
      <div className="panel">
        <table className="data"><tbody>{list.map((a) => <tr key={a._id}><td><strong>{a.name}</strong></td><td>{a.email}</td></tr>)}</tbody></table>
      </div>
      {adding && (
        <Modal title="Add MacQuad admin" onClose={() => setAdding(false)}>
          <form className="stack" onSubmit={save}>
            <Input label="Name" form={f} name="name" required />
            <Input label="Email" form={f} name="email" type="email" required />
            <Input label="Password" form={f} name="password" type="password" required autoComplete="new-password" />
            <div className="actions"><button className="btn primary">Add admin</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
