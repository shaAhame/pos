import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";

const money = (n) => Number(n || 0).toFixed(2);
const cell = { padding: "10px", border: "1px solid #ddd" };

const Invoice = React.forwardRef(({ transaction }, ref) => {
  const voided = transaction.paymentStatus === "Voided";
  return (
    <div ref={ref} style={{ padding: "20px", maxWidth: "800px", margin: "auto", border: "1px solid #ddd" }}>
      <div style={{ fontFamily: "Arial, sans-serif", padding: "20px" }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <h1 style={{ margin: "0" }}>MAM Stores</h1>
          <p>524/1, Heyley Road, Haliwala, Galle | Phone: +94 773965339</p>
        </div>

        <h2 style={{ textAlign: "center", textDecoration: "underline" }}>INVOICE</h2>
        {voided && (
          <h2 style={{ textAlign: "center", color: "red" }}>
            VOIDED{transaction.voided?.reason ? ` - ${transaction.voided.reason}` : ""}
          </h2>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
          <div>
            <p><strong>Invoice Number:</strong> {transaction.invoiceNumber}</p>
            <p><strong>Date:</strong> {new Date(transaction.date).toLocaleString()}</p>
            {transaction.cashier?.firstName && (
              <p><strong>Cashier:</strong> {transaction.cashier.firstName} {transaction.cashier.lastName}</p>
            )}
          </div>
          <div>
            <p><strong>Customer:</strong> {transaction.customer?.name || transaction.customerName || "Walk-in Customer"}</p>
            <p><strong>Payment Method:</strong> {transaction.paymentMethod}</p>
            <p><strong>Payment Status:</strong> {transaction.paymentStatus}</p>
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f2f2f2", textAlign: "left" }}>
              <th style={cell}>Item</th>
              <th style={cell}>Quantity</th>
              <th style={cell}>Unit Price</th>
              <th style={cell}>Total Price</th>
            </tr>
          </thead>
          <tbody>
            {transaction.items.map((item, index) => (
              <tr key={index}>
                <td style={cell}>{item.name || item.product?.name || "N/A"}</td>
                <td style={cell}>{item.quantity}</td>
                <td style={cell}>Rs. {money(item.price)}</td>
                <td style={cell}>Rs. {money(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ textAlign: "right", fontSize: "18px" }}>
          <p><strong>Subtotal:</strong> Rs. {money(transaction.subtotal)}</p>
          {transaction.discount > 0 && (
            <p><strong>Discount ({transaction.discount}%):</strong> -Rs. {money(transaction.discountAmount)}</p>
          )}
          {transaction.taxRate > 0 && (
            <p><strong>Tax ({transaction.taxRate}%):</strong> Rs. {money(transaction.taxAmount)}</p>
          )}
          <h3><strong>Grand Total:</strong> Rs. {money(transaction.totalAmount)}</h3>
        </div>

        <div style={{ textAlign: "center", marginTop: "20px", fontSize: "12px" }}>
          <p>Thank you for shopping with us!</p>
          <p>For any queries, contact mamstores@gmail.com</p>
        </div>
      </div>
    </div>
  );
});

const InvoicePage = () => {
  const { id } = useParams();
  const [transaction, setTransaction] = useState(null);
  const [error, setError] = useState("");
  const invoiceRef = useRef(null);

  useEffect(() => {
    axios.get(`/api/sales/${id}`)
      .then((res) => setTransaction(res.data))
      .catch((err) => setError(err?.response?.data?.message || "Could not load invoice"));
  }, [id]);

  const handlePrint = useReactToPrint({
    contentRef: invoiceRef,
    documentTitle: `Invoice ${transaction?.invoiceNumber || ""}`,
  });

  if (error) return <p>{error}</p>;
  if (!transaction) return <p>Loading...</p>;

  return (
    <div>
      <Invoice ref={invoiceRef} transaction={transaction} />
      <button
        onClick={() => handlePrint()}
        style={{ marginTop: "20px", padding: "10px", background: "#007bff", color: "#fff", border: "none", cursor: "pointer" }}
      >
        Print Invoice
      </button>
    </div>
  );
};

export default InvoicePage;
