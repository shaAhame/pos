import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { SessionProvider, useSession } from "./lib/session";
import Layout from "./components/Layout";
import { Login, Setup } from "./pages/Auth";
import Till from "./pages/Till";
import Sales from "./pages/Sales";
import { MyShift, AllShifts } from "./pages/Shifts";
import Products from "./pages/Products";
import { Customers, Suppliers, Employees } from "./pages/People";
import Users from "./pages/Users";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Account from "./pages/Account";
import Branches from "./pages/Branches";
import Transfers from "./pages/Transfers";
import PlatformApp from "./pages/platform/PlatformApp";
import Repairs from "./pages/Repairs";
import Claims from "./pages/Claims";
import Installments from "./pages/Installments";
import Orders from "./pages/Orders";
import Warranty from "./pages/Warranty";

function Guard({ role, feature, any, children }) {
  const { can, has } = useSession();
  if ((feature && !has(feature)) || (any && !any.some(has))) return <div className="empty"><strong>Not switched on for your business</strong>Ask your POS provider if you need this.</div>;
  if (!can(role)) return <div className="empty"><strong>Not available for your role</strong>Ask the shop owner if you need access.</div>;
  return children;
}

function Routed() {
  const { user, ready } = useSession();
  if (!ready) return <div className="empty">Loading…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/till" element={<Till />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/sales/:id" element={<Sales />} />
        <Route path="/shift" element={<MyShift />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/products" element={<Guard role="manager"><Products /></Guard>} />
        <Route path="/suppliers" element={<Guard role="manager"><Suppliers /></Guard>} />
        <Route path="/reports" element={<Guard role="manager"><Reports /></Guard>} />
        <Route path="/shifts" element={<Guard role="manager"><AllShifts /></Guard>} />
        <Route path="/employees" element={<Guard role="owner"><Employees /></Guard>} />
        <Route path="/users" element={<Guard role="owner"><Users /></Guard>} />
        <Route path="/settings" element={<Guard role="owner"><Settings /></Guard>} />
        <Route path="/branches" element={<Guard role="owner"><Branches /></Guard>} />
        <Route path="/transfers" element={<Guard role="manager"><Transfers /></Guard>} />
        <Route path="/repairs" element={<Guard role="cashier" feature="repairs"><Repairs /></Guard>} />
        <Route path="/orders" element={<Guard role="cashier" feature="orders"><Orders /></Guard>} />
        <Route path="/installments" element={<Guard role="cashier" feature="installments"><Installments /></Guard>} />
        <Route path="/warranty" element={<Guard role="cashier" any={["serials", "warranty"]}><Warranty /></Guard>} />
        <Route path="/claims" element={<Guard role="manager" feature="supplierClaims"><Claims /></Guard>} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/till" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  // The MacQuad admin area is a separate app with its own login.
  if (window.location.pathname.startsWith("/platform")) {
    return (<><PlatformApp /><ToastContainer position="bottom-right" autoClose={3500} newestOnTop /></>);
  }
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
      <ToastContainer position="bottom-right" autoClose={3500} newestOnTop />
    </SessionProvider>
  );
}
