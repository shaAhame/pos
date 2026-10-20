import { useId } from "react";

export function Field({ label, hint, children, className = "" }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

// Text/number input bound to form state: <Input label="Name" form={f} name="name" />
export function Input({ label, hint, form, name, className, ...rest }) {
  const id = useId();
  return (
    <div className={`field ${className || ""}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={form.values[name] ?? ""} onChange={(e) => form.set(name, e.target.value)} {...rest} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Select({ label, hint, form, name, options, className, ...rest }) {
  const id = useId();
  return (
    <div className={`field ${className || ""}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={form.values[name] ?? ""} onChange={(e) => form.set(name, e.target.value)} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Empty({ title, children }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>;
}

export function Pager({ page, totalPages, total, onPage, noun = "items" }) {
  if (!total) return null;
  return (
    <div className="pager">
      <span className="muted small">{total} {noun}</span>
      <div className="row">
        <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="small">Page {page} of {Math.max(1, totalPages)}</span>
        <button className="btn small" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}
