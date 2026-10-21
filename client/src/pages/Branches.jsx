import { useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useForm } from "../lib/form";
import Modal from "../components/Modal";
import { Empty, Input, Select } from "../components/ui";

export default function Branches() {
  const { locations, refreshLocations } = useSession();
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="page-head">
        <div><h1>Branches</h1><p>Your shops and warehouses. Every branch keeps its own stock; products and prices are shared.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>Add branch</button>
      </div>
      <div className="panel">
        {!locations.length ? <Empty title="No branches" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Branch</th><th>Type</th><th>Address</th><th>Phone</th><th className="num">Staff</th><th className="num">Units in stock</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l._id} className={l.active ? "" : "voided"}>
                    <td><strong>{l.name}</strong></td>
                    <td>{l.type === "warehouse" ? "Warehouse" : "Shop"}</td>
                    <td>{l.address || <span className="muted">-</span>}</td>
                    <td>{l.phone || <span className="muted">-</span>}</td>
                    <td className="num">{l.staffCount}</td>
                    <td className="num">{l.unitsInStock}</td>
                    <td>{l.active ? <span className="badge green">Open</span> : <span className="badge">Closed</span>}</td>
                    <td className="actions-cell"><button className="btn small" onClick={() => setEdit(l)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>Shops sell and have tills. Warehouses only hold stock and send it to shops with transfers.</p>
      {edit && <BranchForm branch={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refreshLocations(); }} />}
    </>
  );
}

function BranchForm({ branch, onClose, onSaved }) {
  const isNew = !branch._id;
  const f = useForm({ name: branch.name || "", type: branch.type || "store", address: branch.address || "", phone: branch.phone || "" });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isNew) await api.post("/locations", f.values); else await api.put(`/locations/${branch._id}`, f.values);
      toast.success(isNew ? `${f.values.name} added. Its stock starts at 0; send stock with a transfer or receive a delivery there.` : "Branch saved");
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const toggle = async () => {
    if (branch.active && !window.confirm(`Close ${branch.name}? Staff linked to it won't be able to work there until it's reopened.`)) return;
    try { await api.put(`/locations/${branch._id}`, { active: !branch.active }); toast.success(branch.active ? "Branch closed" : "Branch reopened"); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Modal title={isNew ? "Add branch" : `Edit ${branch.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <Input label="Name" form={f} name="name" required className="span-all" placeholder="e.g. Galle branch" />
          <Select label="Type" form={f} name="type" className="span-all" options={[
            { value: "store", label: "Shop: sells to customers" },
            { value: "warehouse", label: "Warehouse / main store: holds stock only" },
          ]} />
          <Input label="Address (printed on receipts)" form={f} name="address" className="span-all" />
          <Input label="Phone (printed on receipts)" form={f} name="phone" />
        </div>
        <div className="row between">
          {!isNew ? <button type="button" className={`btn ${branch.active ? "danger" : ""}`} onClick={toggle}>{branch.active ? "Close branch" : "Reopen branch"}</button> : <span />}
          <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
        </div>
      </form>
    </Modal>
  );
}
