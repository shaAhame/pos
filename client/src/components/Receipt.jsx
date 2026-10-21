import { createPortal } from "react-dom";
import { fmt } from "../lib/money";
import { dateTime, fullName } from "../lib/format";

// 80mm thermal receipt. Also prints fine on A4 (narrow column).
export function Receipt({ sale, settings }) {
  const cur = settings.currency || "Rs.";
  const voided = sale.paymentStatus === "Voided";
  // A branch's own address/phone wins over the business-wide ones.
  const branch = sale.location;
  const address = branch?.address || settings.address;
  const phone = branch?.phone || settings.phone;
  return (
    <div className="receipt">
      <div className="c">
        <div className="shopname">{settings.shopName}</div>
        {branch?.name && branch.name !== settings.shopName && branch.name !== "Main store" && <div>{branch.name}</div>}
        {address && <div>{address}</div>}
        {phone && <div>Tel: {phone}</div>}
      </div>
      <hr />
      <table><tbody>
        <tr><td>{sale.pending ? "Receipt (offline)" : "Invoice"}</td><td className="r">{sale.invoiceNumber}</td></tr>
        <tr><td>Date</td><td className="r">{dateTime(sale.date, settings.timezone)}</td></tr>
        {sale.cashier && <tr><td>Cashier</td><td className="r">{fullName(sale.cashier)}</td></tr>}
        {sale.customerName && sale.customerName !== "Walk-in Customer" && <tr><td>Customer</td><td className="r">{sale.customerName}</td></tr>}
      </tbody></table>
      {voided && <div className="stamp">VOIDED</div>}
      <hr />
      <table><tbody>
        {sale.items.map((i, idx) => (
          <tr key={i._id || idx}>
            <td>{i.name}<br /><span>{i.quantity} x {fmt(i.price)}</span></td>
            <td className="r">{fmt(i.total ?? i.price * i.quantity)}</td>
          </tr>
        ))}
      </tbody></table>
      <hr />
      <table><tbody>
        <tr><td>Subtotal</td><td className="r">{fmt(sale.subtotal)}</td></tr>
        {sale.discountAmount > 0 && <tr><td>Discount ({sale.discount}%)</td><td className="r">-{fmt(sale.discountAmount)}</td></tr>}
        {sale.taxAmount > 0 && <tr><td>Tax ({sale.taxRate}%)</td><td className="r">{fmt(sale.taxAmount)}</td></tr>}
        <tr className="total"><td>TOTAL {cur}</td><td className="r">{fmt(sale.totalAmount)}</td></tr>
        <tr><td>Paid by</td><td className="r">{sale.paymentMethod}</td></tr>
        {sale.amountTendered != null && <tr><td>Cash given</td><td className="r">{fmt(sale.amountTendered)}</td></tr>}
        {sale.changeGiven != null && <tr><td>Change</td><td className="r">{fmt(sale.changeGiven)}</td></tr>}
        {sale.refundedAmount > 0 && <tr><td>Refunded</td><td className="r">-{fmt(sale.refundedAmount)}</td></tr>}
      </tbody></table>
      <hr />
      {sale.pending && <div className="c">Saved offline. Invoice number is given when the till is back online.</div>}
      {settings.receiptFooter && <div className="c">{settings.receiptFooter}</div>}
    </div>
  );
}

// Renders the receipt into #print-root and opens the browser print dialog.
// (Set the receipt printer as default and turn on "open cash drawer" in its driver.)
export function PrintReceipt({ sale, settings }) {
  const target = document.getElementById("print-root");
  if (!target || !sale) return null;
  return createPortal(<Receipt sale={sale} settings={settings} />, target);
}

export const printNow = () => setTimeout(() => window.print(), 50);
