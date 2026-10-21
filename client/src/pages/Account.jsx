import { useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useForm } from "../lib/form";
import { Input } from "../components/ui";
import { fullName } from "../lib/format";

export default function Account() {
  const { user, can, refreshMe } = useSession();
  const f = useForm({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (f.values.newPassword !== f.values.confirm) return toast.error("The new passwords don't match");
    setBusy(true);
    try {
      await api.post("/auth/password", { currentPassword: f.values.currentPassword, newPassword: f.values.newPassword });
      toast.success("Password changed");
      f.reset();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Account</h1><p>{fullName(user)}, {user.email}</p></div></div>
      <form className="panel pad stack" style={{ maxWidth: 480 }} onSubmit={submit}>
        <h2>Change password</h2>
        <Input label="Current password" form={f} name="currentPassword" type="password" autoComplete="current-password" required />
        <Input label="New password" form={f} name="newPassword" type="password" autoComplete="new-password" required hint="At least 8 characters, with upper and lower case letters and a number." />
        <Input label="Type the new password again" form={f} name="confirm" type="password" autoComplete="new-password" required />
        <div className="actions"><button className="btn primary" disabled={busy}>Change password</button></div>
      </form>
      {can("manager") && <ApprovalPin has={user.hasApprovalPin} onSaved={refreshMe} />}
    </>
  );
}

function ApprovalPin({ has, onSaved }) {
  const f = useForm({ currentPassword: "", pin: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.post("/auth/approval-pin", f.values); toast.success("Approval PIN saved"); f.reset(); onSaved?.(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form className="panel pad stack" style={{ maxWidth: 480, marginTop: 16 }} onSubmit={submit}>
      <h2>Discount approval PIN</h2>
      <p className="muted">{has ? "Your PIN is set. " : "Not set yet. "}When a cashier gives more discount than they're allowed, you type this PIN at their till to approve it.</p>
      <Input label="Your password" form={f} name="currentPassword" type="password" autoComplete="current-password" required />
      <Input label="New PIN (4 to 8 digits)" form={f} name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" required />
      <div className="actions"><button className="btn primary" disabled={busy}>{has ? "Change PIN" : "Set PIN"}</button></div>
    </form>
  );
}
