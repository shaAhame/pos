import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useApi, useDebounced } from "../lib/hooks";
import { useForm, clean } from "../lib/form";
import { fmt } from "../lib/money";
import Modal from "../components/Modal";
import { Empty, Input, Loading, Pager } from "../components/ui";

// One page component for simple lists of records (customers, suppliers, employees).
function RecordsPage({ title, intro, endpoint, listKey, noun, fields, columns, numeric = [], canDelete, addLabel }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const dq = useDebounced(q, 300);
  const list = useApi(endpoint, { filter: dq || undefined, page, limit: 25 });
  useEffect(() => { setPage(1); }, [dq]);
  const rows = list.data?.[listKey] || [];

  return (
    <>
      <div className="page-head">
        <div><h1>{title}</h1><p>{intro}</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>{addLabel}</button>
      </div>
      <div className="toolbar">
        <div className="field"><label htmlFor="rq">Search</label><input id="rq" type="search" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="panel">
        {list.loading && !list.data ? <Loading /> : list.error ? <Empty title="Couldn't load">{list.error}</Empty> : !rows.length ? (
          <Empty title={dq ? `No ${noun} match "${dq}"` : `No ${noun} yet`} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}<th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r._id}>
                      {columns.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render ? c.render(r) : r[c.key] || <span className="muted">-</span>}</td>)}
                      <td className="actions-cell"><button className="btn small" onClick={() => setEdit(r)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} noun={noun} />
          </>
        )}
      </div>
      {edit && (
        <RecordForm record={edit} endpoint={endpoint} fields={fields} numeric={numeric} canDelete={canDelete} noun={noun}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />
      )}
    </>
  );
}

function RecordForm({ record, endpoint, fields, numeric, canDelete, noun, onClose, onSaved }) {
  const isNew = !record._id;
  const f = useForm(Object.fromEntries(fields.map((x) => [x.name, record[x.name] ?? ""])));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = clean(f.values, numeric);
      if (isNew) await api.post(endpoint, body); else await api.put(`${endpoint}/${record._id}`, body);
      toast.success("Saved");
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${record.name}? This can't be undone.`)) return;
    try { await api.delete(`${endpoint}/${record._id}`); toast.success("Deleted"); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Modal title={isNew ? `Add ${noun.replace(/s$/, "")}` : `Edit ${record.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          {fields.map((x) => <Input key={x.name} label={x.label} form={f} name={x.name} type={x.type || "text"} required={x.required} hint={x.hint} className={x.wide ? "span-all" : ""} {...(x.type === "number" ? { min: 0, step: "0.01" } : {})} />)}
        </div>
        <div className="row between">
          {!isNew && canDelete ? <button type="button" className="btn danger" onClick={remove}>Delete</button> : <span />}
          <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
        </div>
      </form>
    </Modal>
  );
}

export function Customers() {
  const { can } = useSession();
  return (
    <RecordsPage title="Customers" intro="Regular customers, so their name appears on receipts and in sales history."
      endpoint="/customers" listKey="customers" noun="customers" addLabel="Add customer" canDelete={can("manager")}
      fields={[
        { name: "name", label: "Name", required: true, wide: true },
        { name: "contactNumber", label: "Phone", required: true, type: "tel" },
        { name: "email", label: "Email (optional)", type: "email" },
        { name: "address", label: "Address (optional)", wide: true },
      ]}
      columns={[
        { key: "name", label: "Name", render: (r) => <strong>{r.name}</strong> },
        { key: "contactNumber", label: "Phone" }, { key: "email", label: "Email" }, { key: "address", label: "Address" },
      ]} />
  );
}

export function Suppliers() {
  return (
    <RecordsPage title="Suppliers" intro="Who you buy from. Pick a supplier when you receive a delivery on the Products page."
      endpoint="/suppliers" listKey="suppliers" noun="suppliers" addLabel="Add supplier" canDelete
      fields={[
        { name: "name", label: "Contact person", required: true },
        { name: "company", label: "Company", required: true },
        { name: "contactNumber", label: "Phone", required: true, type: "tel" },
        { name: "email", label: "Email", required: true, type: "email" },
        { name: "address", label: "Address", required: true, wide: true },
      ]}
      columns={[
        { key: "company", label: "Company", render: (r) => <strong>{r.company}</strong> },
        { key: "name", label: "Contact" }, { key: "contactNumber", label: "Phone" }, { key: "email", label: "Email" },
      ]} />
  );
}

export function Employees() {
  return (
    <RecordsPage title="Employees" intro="Staff records and salaries. Only the owner can see this page. Till logins are under Staff logins."
      endpoint="/employees" listKey="employees" noun="employees" addLabel="Add employee" canDelete numeric={["salary"]}
      fields={[
        { name: "name", label: "Name", required: true, wide: true },
        { name: "position", label: "Position", required: true },
        { name: "salary", label: "Monthly salary", required: true, type: "number" },
        { name: "contactNumber", label: "Phone", required: true, type: "tel" },
        { name: "email", label: "Email", required: true, type: "email" },
      ]}
      columns={[
        { key: "name", label: "Name", render: (r) => <strong>{r.name}</strong> },
        { key: "position", label: "Position" }, { key: "contactNumber", label: "Phone" },
        { key: "salary", label: "Salary", num: true, render: (r) => fmt(r.salary) },
      ]} />
  );
}
