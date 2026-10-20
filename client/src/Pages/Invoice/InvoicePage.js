import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";

const InvoicePage = () => {
  const { id } = useParams(); // Get the transaction ID from the URL
  const [transaction, setTransaction] = useState(null);
  const invoiceRef = useRef(); // Create a ref for the Invoice component

  useEffect(() => {
    const fetchTransaction = async () => {
      try {
        const response = await axios.get(`http://localhost:5000/api/sales/${id}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`, // Assuming JWT token stored in localStorage
          },
        });
        setTransaction(response.data); // Store the fetched transaction data
      } catch (error) {
        console.error("Error fetching transaction:", error);
      }
    };

    fetchTransaction();
  }, [id]);

  const handlePrint = useReactToPrint({
    content: () => {
      if (invoiceRef.current) {
        return invoiceRef.current; // Ensure ref is valid
      }
      console.error("Invoice content not available for printing.");
      return null; // Return null to avoid errors if ref is invalid
    },
    documentTitle: `Invoice #${transaction?.invoiceNumber || "N/A"}`,
    onAfterPrint: () => console.log("Printing complete!"),
  });

  if (!transaction) {
    return <p>Loading...</p>; // Show loading until transaction data is fetched
  }

  const Invoice = React.forwardRef(({ transaction }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          padding: "20px",
          maxWidth: "800px",
          margin: "auto",
          border: "1px solid #ddd",
        }}
      >
        <div style={{ fontFamily: "Arial, sans-serif", padding: "20px" }}>
          {/* Invoice Content */}
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <h1 style={{ margin: "0" }}>MAM Stores</h1>
            <p>524/1, Heyley Road, Haliwala, Galle | Phone: +91 773965339</p>
          </div>

          <h2 style={{ textAlign: "center", textDecoration: "underline" }}>INVOICE</h2>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <p><strong>Invoice Number:</strong> {transaction.invoiceNumber}</p>
              <p><strong>Date:</strong> {new Date().toLocaleDateString()}</p>
            </div>
            <div>
              <p><strong>Customer:</strong> {transaction.customer?.name || "Unknown"}</p>
              <p><strong>Payment Method:</strong> {transaction.paymentMethod}</p>
              <p><strong>Payment Status:</strong> {transaction.paymentStatus}</p>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px" }}>
            <thead>
              <tr style={{ backgroundColor: "#f2f2f2", textAlign: "left" }}>
                <th style={{ padding: "10px", border: "1px solid #ddd" }}>Item</th>
                <th style={{ padding: "10px", border: "1px solid #ddd" }}>Quantity</th>
                <th style={{ padding: "10px", border: "1px solid #ddd" }}>Unit Price</th>
                <th style={{ padding: "10px", border: "1px solid #ddd" }}>Total Price</th>
              </tr>
            </thead>
            <tbody>
              {transaction.items.map((item, index) => (
                <tr key={index} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "10px", border: "1px solid #ddd" }}>{item.product?.name || "N/A"}</td>
                  <td style={{ padding: "10px", border: "1px solid #ddd" }}>{item.quantity}</td>
                  <td style={{ padding: "10px", border: "1px solid #ddd" }}>Rs. {item.price.toFixed(2)}</td>
                  <td style={{ padding: "10px", border: "1px solid #ddd" }}>Rs. {item.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ textAlign: "right", fontSize: "18px" }}>
            <p><strong>Subtotal:</strong> Rs. {transaction.subtotal.toFixed(2)}</p>
            <p><strong>Discount ({transaction.discount}%):</strong> -Rs. {(transaction.subtotal * (transaction.discount / 100)).toFixed(2)}</p>
            <p><strong>Tax ({transaction.taxRate}%):</strong> Rs. {transaction.taxAmount.toFixed(2)}</p>
            <h3><strong>Grand Total:</strong> Rs. {transaction.totalAmount.toFixed(2)}</h3>
          </div>

          <div style={{ textAlign: "center", marginTop: "20px", fontSize: "12px" }}>
            <p>Thank you for shopping with us!</p>
            <p>For any queries, contact mamstores@gmail.com</p>
          </div>
        </div>
      </div>
    );
  });

  return (
    <div>
      <Invoice ref={invoiceRef} transaction={transaction} />
      <button
        onClick={handlePrint}
        style={{
          marginTop: "20px",
          padding: "10px",
          background: "#007bff",
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        Print Invoice
      </button>
    </div>
  );
};

export default InvoicePage;
