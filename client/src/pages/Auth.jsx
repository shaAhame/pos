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

  useEffect(() => { api.get("/auth/status").then((r) => setNeedsSetup(r.data.needsPlatformSetup)).catch(() => {}); }, []);

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
          <div className="notice green">This system hasn't been set up yet. <a href="/platform">Set up the platform</a></div>
        )}
        <Input label="Email" form={f} name="email" type="email" autoComplete="username" required />
        <Input label="Password" form={f} name="password" type="password" autoComplete="current-password" required />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn primary big" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
      </form>
    </div>
  );
}

// Shops are now created by the MacQuad admin; kept as a redirect for old bookmarks.
export function Setup() {
  return <div className="auth"><div className="card stack"><h1>New shops are set up by your POS provider</h1><p className="muted">Ask them for your login, then <Link to="/login">log in here</Link>.</p></div></div>;
}
