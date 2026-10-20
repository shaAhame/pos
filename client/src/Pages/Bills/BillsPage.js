import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

const BillPage = () => {
  const [transactions, setTransactions] = useState([]);
  const navigate = useNavigate();

  const load = () =>
    axios.get("/api/sales")
      .then((res) => setTransactions(res.data))
      .catch(() => toast.error("Could not load transactions"));

  useEffect(() => { load(); }, []);

  // Sales are never deleted. Voiding keeps the record and puts the stock back.
  const handleVoid = async (t) => {
    const reason = window.prompt(`Void ${t.invoiceNumber}? Stock will be returned.\n\nReason:`);
    if (reason === null) return;
    if (!reason.trim()) return toast.error("A reason is required to void a sale");
    try {
      await axios.post(`/api/sales/${t._id}/void`, { reason });
      toast.success(`${t.invoiceNumber} voided`);
      load();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not void sale");
    }
  };

  return (
    <div>
      <h2>All Transactions</h2>
      <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Invoice No</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Total Amount</th>
            <th>Status</th>
            <th>Payment Method</th>
            <th>Items</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const voided = t.paymentStatus === "Voided";
            return (
              <tr key={t._id} style={voided ? { color: "#999", textDecoration: "line-through" } : undefined}>
                <td>{t.invoiceNumber}</td>
                <td>{new Date(t.date).toLocaleString()}</td>
                <td>{t.customer?.name || t.customerName || "Walk-in Customer"}</td>
                <td>Rs.{Number(t.totalAmount || 0).toFixed(2)}</td>
                <td>{t.paymentStatus}</td>
                <td>{t.paymentMethod}</td>
                <td>
                  {t.items.map((item, index) => (
                    <div key={index}>{item.name || item.product?.name || "Unknown"} (x{item.quantity})</div>
                  ))}
                </td>
                <td style={{ textDecoration: "none" }}>
                  <button onClick={() => navigate(`/invoice/${t._id}`)}>Invoice</button>
                  {!voided && (
                    <button onClick={() => handleVoid(t)} style={{ marginLeft: "5px", color: "red" }}>Void</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
};

export default BillPage;
