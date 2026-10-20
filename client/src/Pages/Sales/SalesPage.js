import React, { useState, useEffect } from "react";
import axios from "axios";
import BarcodeScanner from "../../components/BarcodeScanner/BarcodeScanner";
import { toast } from "react-toastify";
import './salesPage.css';

const SalesPage = () => {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [lastScanned, setLastScanned] = useState(null);
  const [customers, setCustomers] = useState([]); // State for customers
  const [searchTerm, setSearchTerm] = useState(""); // State for search term
  const [searchResults, setSearchResults] = useState([]); // State for search results

  useEffect(() => {
    // Fetch products and customers from the API
    axios.get("/api/products")
      .then((res) => setProducts(res.data.products))
      .catch((err) => console.error(err));

    axios.get("/api/customers")
      .then((res) => setCustomers(res.data.customers))
      .catch((err) => console.error(err));
  }, []);

  const addToCart = (product) => {
    if (!product) return;

    setCart((prev) => {
      const existing = prev.find((item) => item._id === product._id);
      if (existing) {
        return prev.map((item) =>
          item._id === product._id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId, change) => {
    setCart((prev) =>
      prev.map((item) =>
        item._id === productId
          ? { ...item, quantity: Math.max(1, item.quantity + change) }
          : item
      )
    );
  };

  const handleManualQuantityChange = (productId, value) => {
    const newQuantity = parseInt(value, 10);
    setCart((prev) =>
      prev.map((item) =>
        item._id === productId
          ? { ...item, quantity: isNaN(newQuantity) || newQuantity < 1 ? 1 : newQuantity }
          : item
      )
    );
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return toast.error("Cart is empty");

    // Determine the customer name from selected customer or use 'Guest'
  const customerName =
  typeof customer === "object" && customer.name
    ? customer.name
    : searchTerm.trim() !== ""
    ? searchTerm.trim()
    : "Guest";

    const transaction = {
      customer: { name: customerName },
      items: cart.map((item) => ({
        product: item._id,
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
      })),
      totalAmount,
      paymentMethod,
    };

    try {
      await axios.post("/api/sales", transaction);
      toast.success("Transaction successful!");
      setCart([]);
      setCustomer(""); 
      setPaymentMethod("Cash"); 
      setSearchTerm(""); 
    } catch (error) {
      toast.error("Transaction failed!");
    }
  };

  // Filter customers based on search input
  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.contactNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle barcode scan
  const handleScan = (scannedBarcode) => {
    const matchedProduct = products.find(p => p.barcode === scannedBarcode);
    
    if (matchedProduct) {
      addToCart(matchedProduct); // Add to cart if found
    } else {
      toast.error("Product not found for scanned barcode");
      
      // Update search results for manual search
      const filteredResults = products.filter(p =>
        p.name.toLowerCase().includes(scannedBarcode.toLowerCase()) ||
        p.barcode.toLowerCase().includes(scannedBarcode.toLowerCase())
      );
      setSearchResults(filteredResults); // Show products matching search
    }
  };

  return (
    <div className="sales-page">
      <h2>Sales Page</h2>

      <div className="page-content">
        <div className="content-container">
          <div className="product-selection">
            {/* Product Selection via Barcode Scanner */}
            <BarcodeScanner onScan={handleScan} />

            {/* Manual Product Selection */}
            <select
              onChange={(e) => {
                const selectedProduct = products.find((p) => p._id === e.target.value);
                addToCart(selectedProduct);
              }}
            >
              <option value="">Select Product</option>
              {products.map((product) => (
                <option key={product._id} value={product._id}>
                  {product.name} - ${product.price}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cart and Payment Section */}
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
                        <button onClick={() => updateQuantity(item._id, -1)}>-</button>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleManualQuantityChange(item._id, e.target.value)}
                          style={{ width: "50px", textAlign: "center" }}
                        />
                        <button onClick={() => updateQuantity(item._id, 1)}>+</button>
                      </td>
                      <td>{item.price}</td>
                      <td>{(item.quantity * item.price).toFixed(2)}</td>
                      <td>
                        <button onClick={() => setCart(cart.filter((c) => c._id !== item._id))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>Cart is empty</p>
            )}

            <h3>Sub Total: Rs. {totalAmount.toFixed(2)}</h3>
          </div>

          {/* Payment Section */}
          <div className="payment-section">
            <div>
              <label>Customer:</label>
              <input
                type="text"
                placeholder="Search by Name or Phone"
                value={typeof customer === "object" ? customer.name : customer}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <ul className="customer-search-results">
                  {filteredCustomers.map((customer) => (
                    <li
                      key={customer._id}
                      onClick={() => {
                        setCustomer(customer); // Set selected customer
                        setSearchTerm(""); // Clear search term
                      }}
                    >
                      {customer.name} - {customer.phone}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label>Payment Method:</label>
              <div className="payment-method-buttons">
                <button
                  onClick={() => setPaymentMethod("Cash")}
                  className={paymentMethod === "Cash" ? "selected" : ""}
                >
                  Cash
                </button>
                <button
                  onClick={() => setPaymentMethod("Card")}
                  className={paymentMethod === "Card" ? "selected" : ""}
                >
                  Card
                </button>
                <button onClick={handleCheckout}>Checkout</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalesPage;
