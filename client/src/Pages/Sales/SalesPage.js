import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import BarcodeScanner from "../../components/BarcodeScanner/BarcodeScanner";
import { toast } from "react-toastify";
import './salesPage.css';

const money = (n) => Number(n || 0).toFixed(2);
const errMsg = (error, fallback) => error?.response?.data?.message || error?.response?.data?.error || fallback;

const SalesPage = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);      // selected registered customer
  const [searchTerm, setSearchTerm] = useState("");    // text typed in customer box
  const [customers, setCustomers] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const loadProducts = useCallback(() => {
    axios.get("/api/products", { params: { limit: 1000 } })
      .then((res) => setProducts(res.data.products))
      .catch(() => toast.error("Could not load products"));
  }, []);

  useEffect(() => {
    loadProducts();
    axios.get("/api/customers", { params: { limit: 1000 } })
      .then((res) => setCustomers(res.data.customers))
      .catch(() => toast.error("Could not load customers"));
  }, [loadProducts]);

  const addToCart = (product) => {
    if (!product) return;
    const inCart = cart.find((i) => i._id === product._id)?.quantity || 0;
    if (inCart + 1 > product.quantity) {
      toast.warn(`Only ${product.quantity} of "${product.name}" in stock`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => item._id === product._id);
      if (existing) {
        return prev.map((item) => item._id === product._id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { _id: product._id, name: product.name, price: product.price, stock: product.quantity, quantity: 1 }];
    });
  };

  const setQuantity = (productId, qty) => {
    setCart((prev) => prev.map((item) => {
      if (item._id !== productId) return item;
      let q = Number.isInteger(qty) && qty >= 1 ? qty : 1;
      if (q > item.stock) {
        toast.warn(`Only ${item.stock} of "${item.name}" in stock`);
        q = item.stock;
      }
      return { ...item, quantity: q };
    }));
  };

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = (subtotal * (Number(discount) || 0)) / 100;
  const taxAmount = ((subtotal - discountAmount) * (Number(taxRate) || 0)) / 100;
  const grandTotal = subtotal - discountAmount + taxAmount;

  const resetSale = () => {
    setCart([]);
    setCustomer(null);
    setSearchTerm("");
    setPaymentMethod("Cash");
    setDiscount(0);
    setTaxRate(0);
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return toast.error("Cart is empty");
    if (submitting) return;
    setSubmitting(true);

    const transaction = {
      items: cart.map((item) => ({ product: item._id, quantity: item.quantity })),
      customer: customer?._id,
      customerName: customer ? undefined : searchTerm.trim(),
      paymentMethod,
      discount: Number(discount) || 0,
      taxRate: Number(taxRate) || 0,
    };

    try {
      const { data } = await axios.post("/api/sales", transaction);
      toast.success(`Sale ${data.sale.invoiceNumber} recorded`);
      resetSale();
      loadProducts(); // refresh stock levels
      navigate(`/invoice/${data.sale._id}`);
    } catch (error) {
      toast.error(errMsg(error, "Transaction failed"));
      loadProducts();
    } finally {
      setSubmitting(false);
    }
  };

  const term = searchTerm.toLowerCase();
  const filteredCustomers = term
    ? customers.filter((c) =>
        (c.name || "").toLowerCase().includes(term) ||
        (c.contactNumber || "").toLowerCase().includes(term))
    : [];

  // Scanner: look the barcode up on the server so every product is found, not just the first page.
  const handleScan = useCallback(async (scannedBarcode) => {
    const code = (scannedBarcode || "").trim();
    if (!code) return;
    try {
      const { data } = await axios.get(`/api/products/barcode/${encodeURIComponent(code)}`);
      addToCart(data);
    } catch (error) {
      toast.error(`No product found for barcode "${code}"`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  return (
    <div className="sales-page">
      <h2>Sales Page</h2>

      <div className="page-content">
        <div className="content-container">
          <div className="product-selection">
            <BarcodeScanner onScan={handleScan} />

            <select
              value=""
              onChange={(e) => addToCart(products.find((p) => p._id === e.target.value))}
            >
              <option value="">Select Product</option>
              {products.map((product) => (
                <option key={product._id} value={product._id} disabled={product.quantity <= 0}>
                  {product.name} - Rs. {money(product.price)} ({product.quantity > 0 ? `${product.quantity} in stock` : "out of stock"})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="cart-payment-container">
          <div className="cart-container">
            <h3>Cart</h3>
            {cart.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item) => (
                    <tr key={item._id}>
                      <td>{item.name}</td>
                      <td>
                        <button onClick={() => setQuantity(item._id, item.quantity - 1)}>-</button>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => setQuantity(item._id, parseInt(e.target.value, 10))}
                          style={{ width: "50px", textAlign: "center" }}
                        />
                        <button onClick={() => setQuantity(item._id, item.quantity + 1)}>+</button>
                      </td>
                      <td>{money(item.price)}</td>
                      <td>{money(item.quantity * item.price)}</td>
                      <td>
                        <button onClick={() => setCart(cart.filter((c) => c._id !== item._id))}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>Cart is empty</p>
            )}

            <p>Sub Total: Rs. {money(subtotal)}</p>
            {discountAmount > 0 && <p>Discount ({discount}%): -Rs. {money(discountAmount)}</p>}
            {taxAmount > 0 && <p>Tax ({taxRate}%): Rs. {money(taxAmount)}</p>}
            <h3>Total: Rs. {money(grandTotal)}</h3>
          </div>

          <div className="payment-section">
            <div>
              <label>Customer:</label>
              {customer ? (
                <div>
                  <strong>{customer.name}</strong> ({customer.contactNumber}){" "}
                  <button onClick={() => setCustomer(null)}>Change</button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search by name or phone (or leave blank for walk-in)"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {filteredCustomers.length > 0 && (
                    <ul className="customer-search-results">
                      {filteredCustomers.slice(0, 10).map((c) => (
                        <li key={c._id} onClick={() => { setCustomer(c); setSearchTerm(""); }}>
                          {c.name} - {c.contactNumber}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div>
              <label>Discount (%):</label>
              <input type="number" min="0" max="100" value={discount}
                onChange={(e) => setDiscount(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
              <label>Tax (%):</label>
              <input type="number" min="0" max="100" value={taxRate}
                onChange={(e) => setTaxRate(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
            </div>

            <div>
              <label>Payment Method:</label>
              <div className="payment-method-buttons">
                <button onClick={() => setPaymentMethod("Cash")} className={paymentMethod === "Cash" ? "selected" : ""}>
                  Cash
                </button>
                <button onClick={() => setPaymentMethod("Card")} className={paymentMethod === "Card" ? "selected" : ""}>
                  Card
                </button>
                <button onClick={handleCheckout} disabled={submitting || cart.length === 0}>
                  {submitting ? "Saving..." : "Checkout"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalesPage;
