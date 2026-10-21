import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useForm, clean } from "../lib/form";
import { Input } from "../components/ui";
import { Receipt } from "../components/Receipt";

export default function Settings() {
  const { settings, refreshSettings } = useSession();
  const f = useForm(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => { f.reset(settings); }, [settings.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const v = clean(f.values, ["defaultTaxRate", "maxCashierDiscount"]);
    try {
      await api.put("/settings", {
        shopName: v.shopName, address: v.address, phone: v.phone, email: v.email, receiptFooter: v.receiptFooter,
        currency: v.currency, defaultTaxRate: v.defaultTaxRate ?? 0, maxCashierDiscount: v.maxCashierDiscount ?? 0, timezone: v.timezone,
      });
      await refreshSettings();
      toast.success("Settings saved");
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const preview = {
    invoiceNumber: "INV-000123", date: new Date().toISOString(), cashier: { firstName: "Sample", lastName: "Cashier" },
    customerName: "Walk-in Customer", paymentMethod: "Cash",
    items: [{ name: "Example item", quantity: 2, price: 150, total: 300 }],
    subtotal: 300, discount: 0, discountAmount: 0, taxRate: Number(f.values.defaultTaxRate) || 0,
    taxAmount: Math.round(300 * (Number(f.values.defaultTaxRate) || 0)) / 100,
    totalAmount: 300 + Math.round(300 * (Number(f.values.defaultTaxRate) || 0)) / 100, amountTendered: 500,
  };
  preview.changeGiven = Math.round((500 - preview.totalAmount) * 100) / 100;

  return (
    <>
      <div className="page-head"><div><h1>Shop settings</h1><p>Shown on receipts and used across the till.</p></div></div>
      <div className="two-col">
        <form className="panel pad stack" onSubmit={save}>
          <h2>Receipt details</h2>
          <div className="form-grid">
            <Input label="Shop name" form={f} name="shopName" required className="span-all" />
            <Input label="Address" form={f} name="address" className="span-all" />
            <Input label="Phone" form={f} name="phone" />
            <Input label="Email" form={f} name="email" type="email" />
            <Input label="Message at the bottom of receipts" form={f} name="receiptFooter" className="span-all" />
          </div>
          <h2>Selling</h2>
          <div className="form-grid">
            <Input label="Currency symbol" form={f} name="currency" required />
            <Input label="Default tax %" form={f} name="defaultTaxRate" type="number" min="0" max="100" step="0.01" hint="Filled in on every new sale; can be changed per sale." />
            <Input label="Most discount a cashier can give (%)" form={f} name="maxCashierDiscount" type="number" min="0" max="100" step="0.5" hint="Managers and owners have no limit." />
            <Input label="Time zone" form={f} name="timezone" required hint="Used for daily reports, e.g. Asia/Colombo" />
          </div>
          <div className="actions"><button className="btn primary" disabled={busy}>Save settings</button></div>
        </form>
        <div className="stack">
          <h3>Receipt preview</h3>
          <div className="panel" style={{ padding: 8 }}><Receipt sale={preview} settings={{ ...settings, ...f.values }} /></div>
        </div>
      </div>
    </>
  );
}
