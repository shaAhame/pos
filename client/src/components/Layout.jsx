import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../lib/session";
import { fullName } from "../lib/format";

const NAV = [
  { to: "/till", label: "Till", role: "cashier" },
  { to: "/sales", label: "Sales", role: "cashier" },
  { to: "/shift", label: "My shift", role: "cashier" },
  { to: "/customers", label: "Customers", role: "cashier" },
  { group: "Stock", role: "manager" },
  { to: "/products", label: "Products", role: "manager" },
  { to: "/transfers", label: "Transfers", role: "manager" },
  { to: "/suppliers", label: "Suppliers", role: "manager" },
  { group: "Business", role: "manager" },
  { to: "/reports", label: "Reports", role: "manager" },
  { to: "/shifts", label: "All shifts", role: "manager" },
  { to: "/employees", label: "Employees", role: "owner" },
  { to: "/users", label: "Staff logins", role: "owner" },
  { to: "/branches", label: "Branches", role: "owner" },
  { to: "/settings", label: "Shop settings", role: "owner" },
];

export default function Layout() {
  const { user, settings, can, online, queueCount, logout, shift, sync, multiBranch, activeLocations, location, locationId, chooseLocation } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const roleName = { owner: "Owner", manager: "Manager", cashier: "Cashier" }[user.role];

  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn ghost small menu-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="sidebar">Menu</button>
        <span className="shop">{settings.shopName}</span>
        {multiBranch && user.role === "owner" ? (
          <>
            <label htmlFor="branch-pick" className="visually-hidden">Branch</label>
            <select id="branch-pick" className="branch-pick" value={locationId || ""} onChange={(e) => chooseLocation(e.target.value || null)}>
              <option value="">All branches</option>
              {activeLocations.map((l) => <option key={l._id} value={l._id}>{l.name}{l.type === "warehouse" ? " (warehouse)" : ""}</option>)}
            </select>
          </>
        ) : multiBranch && location ? <span className="branch-name">{location.name}</span> : null}
        <span className="spacer" />
        {online && queueCount === 0 ? (
          <span className="status-pill" title="Connected"><span className="dot" />Online</span>
        ) : (
          <button className="status-pill off" style={{ border: 0, font: "inherit", cursor: "pointer" }} onClick={() => sync({ quiet: false })} title="Try to upload now">
            <span className="dot" />
            {online ? `Uploading ${queueCount} sale${queueCount === 1 ? "" : "s"}` : `Offline${queueCount ? ` (${queueCount} waiting)` : ""}`}
          </button>
        )}
        <span className="hide-sm small" style={{ opacity: .8 }}>{shift ? "Shift open" : "No shift"}</span>
        <NavLink to="/account" className="btn ghost small hide-sm">{fullName(user)} ({roleName})</NavLink>
        <button className="btn ghost small" onClick={() => logout()}>Log out</button>
      </header>
      <aside id="sidebar" className={`sidebar${open ? " open" : ""}`} onClick={() => setOpen(false)}>
        <nav aria-label="Main">
          {NAV.filter((n) => can(n.role)).map((n) =>
            n.group ? <div key={n.group} className="group">{n.group}</div>
              : <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive || loc.pathname.startsWith(n.to + "/") ? "active" : "")}>{n.label}</NavLink>
          )}
          <div className="group">You</div>
          <NavLink to="/account">Account</NavLink>
        </nav>
      </aside>
      <main className="main">
        {/* Re-mount the page when the owner switches branch so everything reloads for that branch. */}
        <Outlet key={locationId || "all"} />
      </main>
    </div>
  );
}
