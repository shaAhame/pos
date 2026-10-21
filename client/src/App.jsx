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

function Guard({ role, children }) {
  const { can } = useSession();
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
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/till" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
      <ToastContainer position="bottom-right" autoClose={3500} newestOnTop />
    </SessionProvider>
  );
}
