import { useEffect, useRef } from "react";

export default function Modal({ title, onClose, children, footer, wide, labelledBy = "modal-title" }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const first = ref.current?.querySelector("input:not([type=hidden]), select, textarea, button.primary, button");
    first?.focus();
    // Escape closes only the top-most dialog when dialogs are stacked.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const all = document.querySelectorAll(".modal-backdrop");
      if (ref.current && all[all.length - 1] === ref.current.parentElement) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className="modal-head">
          <h2 id={labelledBy}>{title}</h2>
          {onClose && <button className="btn ghost small" onClick={onClose} aria-label="Close">Close</button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
