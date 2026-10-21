import { useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi } from "../lib/hooks";
import { useForm } from "../lib/form";
import { dateOnly } from "../lib/format";
import Modal from "../components/Modal";
import { Empty, Input, Loading, Select } from "../components/ui";

const ROLES = [
  { value: "cashier", label: "Cashier: sells, sees own sales, adds customers" },
  { value: "manager", label: "Manager: also products, stock, voids, returns, reports" },
  { value: "owner", label: "Owner: everything, including staff, salaries and settings" },
];
const ROLE_NAME = { cashier: "Cashier", manager: "Manager", owner: "Owner" };

export default function Users() {
  const { settings, user: me, multiBranch } = useSession();
  const { data, loading, reload } = useApi("/users");
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="page-head">
        <div><h1>Staff logins</h1><p>Who can log in to the till, and what they're allowed to do.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>Add staff login</button>
      </div>
      <div className="panel">
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No staff yet" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th>{multiBranch && <th>Branch</th>}<th>Status</th><th>Added</th><th></th></tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u._id} className={u.active ? "" : "voided"}>
                    <td><strong>{u.firstName} {u.lastName}</strong>{u._id === me._id && <span className="muted"> (you)</span>}</td>
                    <td>{u.email}</td>
                    <td>{ROLE_NAME[u.role]}{u.hasApprovalPin && <span className="badge" title="Can approve discounts" style={{ marginLeft: 6 }}>PIN</span>}</td>
                    {multiBranch && <td>{u.role === "owner" ? <span className="muted">All branches</span> : u.location?.name || <span className="danger-text">Not set</span>}</td>}
                    <td>{u.active ? <span className="badge green">Active</span> : <span className="badge">Disabled</span>}</td>
                    <td>{dateOnly(u.createdAt, settings.timezone)}</td>
                    <td className="actions-cell"><button className="btn small" onClick={() => setEdit(u)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <UserForm u={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function UserForm({ u, onClose, onSaved }) {
  const isNew = !u._id;
  const { activeLocations, multiBranch } = useSession();
  const f = useForm({ firstName: u.firstName || "", lastName: u.lastName || "", email: u.email || "", role: u.role || "cashier", password: "", locationId: u.location?._id || "" });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { ...f.values };
    if (!isNew && !body.password) delete body.password;
    if (!multiBranch || body.role === "owner") delete body.locationId;
    try {
      if (isNew) await api.post("/users", body); else await api.put(`/users/${u._id}`, body);
      toast.success(isNew ? "Staff login added. Give them their email and password." : "Saved");
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const toggle = async () => {
    try {
      await api.put(`/users/${u._id}`, { active: !u.active });
      toast.success(u.active ? "Login disabled. They're logged out immediately." : "Login enabled");
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Modal title={isNew ? "Add staff login" : `Edit ${u.firstName}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <Input label="First name" form={f} name="firstName" required />
          <Input label="Last name" form={f} name="lastName" required />
          <Input label="Email (used to log in)" form={f} name="email" type="email" required className="span-all" />
          <Select label="Role" form={f} name="role" options={ROLES} className="span-all" />
          {multiBranch && f.values.role !== "owner" && (
            <Select label="Works at" form={f} name="locationId" className="span-all" required
              options={[{ value: "", label: "Choose a branch" }, ...activeLocations.map((l) => ({ value: l._id, label: l.name }))]} />
          )}
          <Input label={isNew ? "Password" : "New password (leave blank to keep)"} form={f} name="password" type="password" autoComplete="new-password"
            required={isNew} className="span-all" hint="At least 8 characters, with upper and lower case letters and a number." />
        </div>
        <div className="row between">
          {!isNew ? <button type="button" className={`btn ${u.active ? "danger" : ""}`} onClick={toggle}>{u.active ? "Disable login" : "Enable login"}</button> : <span />}
          <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
        </div>
      </form>
    </Modal>
  );
}
