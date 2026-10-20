import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useForm } from "../lib/form";
import { Input } from "../components/ui";

const Brand = () => (
  <div className="brand"><img src="/favicon.svg" alt="" /><strong>Shop POS</strong></div>
);

export function Login() {
  const f = useForm({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { signIn } = useSession();
  const nav = useNavigate();

  useEffect(() => { api.get("/auth/status").then((r) => setNeedsSetup(r.data.needsSetup)).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/auth/login", f.values);
      await signIn(data.token, data.user);
      nav("/till", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Couldn't log in"));
    } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <Brand />
        <div><h1>Log in</h1><p className="muted">Use the email and password the shop owner gave you.</p></div>
        {needsSetup && (
          <div className="notice green">This till hasn't been set up yet. <Link to="/setup">Set up the shop</Link></div>
        )}
        <Input label="Email" form={f} name="email" type="email" autoComplete="username" required />
        <Input label="Password" form={f} name="password" type="password" autoComplete="current-password" required />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn primary big" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
      </form>
    </div>
  );
}

export function Setup() {
  const f = useForm({ shopName: "", firstName: "", lastName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { signIn } = useSession();
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/auth/setup", f.values);
      await signIn(data.token, data.user);
      nav("/settings", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Setup failed"));
    } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <Brand />
        <div><h1>Set up your shop</h1><p className="muted">This creates the owner account. You can add staff afterwards.</p></div>
        <Input label="Shop name" form={f} name="shopName" required placeholder="e.g. MAM Stores" />
        <div className="form-grid">
          <Input label="Your first name" form={f} name="firstName" required />
          <Input label="Last name" form={f} name="lastName" required />
        </div>
        <Input label="Email" form={f} name="email" type="email" autoComplete="username" required />
        <Input label="Password" form={f} name="password" type="password" autoComplete="new-password" required
          hint="At least 8 characters, with upper and lower case letters and a number." />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn primary big" disabled={busy}>{busy ? "Setting up…" : "Create owner account"}</button>
        <Link to="/login" className="small">I already have an account</Link>
      </form>
    </div>
  );
}
