const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const SalesTransaction = require("../models/salesTransaction");
const Product = require("../models/product");
const Customer = require("../models/customer");
const Counter = require("../models/counter");

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isId = (v) => mongoose.Types.ObjectId.isValid(v);

// Put stock back for items that were already deducted (used on failure and on void).
const restock = (items) =>
  Promise.all(items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { quantity: i.quantity } })));

// Create a sale.
// Body: { items: [{ product, quantity }], customer?: id, customerName?, paymentMethod, discount?, taxRate? }
// Prices always come from the database, never from the browser.
router.post("/", async (req, res) => {
  const { items, customer, customerName, paymentMethod, discount = 0, taxRate = 0 } = req.body || {};

  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ message: "Cart is empty" });
  if (!["Cash", "Card"].includes(paymentMethod))
    return res.status(400).json({ message: "Payment method must be Cash or Card" });
  const disc = Number(discount), tax = Number(taxRate);
  if (!(disc >= 0 && disc <= 100) || !(tax >= 0 && tax <= 100))
    return res.status(400).json({ message: "Discount and tax must be between 0 and 100%" });

  // Merge duplicate lines and validate quantities.
  const wanted = new Map();
  for (const it of items) {
    const qty = Number(it && it.quantity);
    if (!it || !isId(it.product) || !Number.isInteger(qty) || qty < 1)
      return res.status(400).json({ message: "Each item needs a valid product and a whole-number quantity of at least 1" });
    wanted.set(String(it.product), (wanted.get(String(it.product)) || 0) + qty);
  }

  let customerDoc = null;
  if (customer) {
    if (!isId(customer)) return res.status(400).json({ message: "Invalid customer" });
    customerDoc = await Customer.findById(customer);
    if (!customerDoc) return res.status(400).json({ message: "Customer not found" });
  }

  // Deduct stock one product at a time. Each update only succeeds if enough stock
  // is available, so two tills can never sell the same last item. If any line
  // fails, everything already deducted is put back.
  const deducted = [];
  const lines = [];
  try {
    for (const [productId, qty] of wanted) {
      const product = await Product.findOneAndUpdate(
        { _id: productId, quantity: { $gte: qty } },
        { $inc: { quantity: -qty } },
        { new: true }
      );
      if (!product) {
        const exists = await Product.findById(productId).select("name quantity");
        await restock(deducted);
        return res.status(409).json({
          message: exists
            ? `Not enough stock for "${exists.name}" (available: ${exists.quantity}, requested: ${qty})`
            : "A product in the cart no longer exists",
          productId,
        });
      }
      deducted.push({ product: product._id, quantity: qty });
      lines.push({
        product: product._id,
        name: product.name,
        quantity: qty,
        price: product.price,
        total: round2(product.price * qty),
      });
    }

    const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
    const discountAmount = round2((subtotal * disc) / 100);
    const taxAmount = round2(((subtotal - discountAmount) * tax) / 100);
    const totalAmount = round2(subtotal - discountAmount + taxAmount);

    const seq = await Counter.next("invoice");
    const sale = await SalesTransaction.create({
      customer: customerDoc ? customerDoc._id : undefined,
      customerName: customerDoc ? customerDoc.name : (customerName || "").trim() || "Walk-in Customer",
      items: lines,
      subtotal,
      discount: disc,
      discountAmount,
      taxRate: tax,
      taxAmount,
      totalAmount,
      paymentStatus: "Paid",
      paymentMethod,
      invoiceNumber: "INV-" + String(seq).padStart(6, "0"),
      cashier: req.user && req.user._id,
    });

    res.status(201).json({ message: "Sale recorded", sale });
  } catch (error) {
    console.error("Error creating sale:", error);
    await restock(deducted).catch((e) => console.error("RESTOCK FAILED, check stock manually:", e, deducted));
    res.status(500).json({ message: "Could not record the sale. Stock was not changed." });
  }
});

// List sales, newest first.
router.get("/", async (req, res) => {
  try {
    const sales = await SalesTransaction.find().sort({ date: -1 })
      .populate("customer", "name contactNumber")
      .populate("items.product", "name"); // for older sales saved before item names were stored
    res.status(200).json(sales);
  } catch (error) {
    res.status(500).json({ message: "Error fetching sales" });
  }
});

// One sale (for the invoice page).
router.get("/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Sale not found" });
  try {
    const sale = await SalesTransaction.findById(req.params.id)
      .populate("customer", "name contactNumber email address")
      .populate("cashier", "firstName lastName")
      .populate("items.product", "name");
    if (!sale) return res.status(404).json({ message: "Sale not found" });
    res.status(200).json(sale);
  } catch (error) {
    res.status(500).json({ message: "Error fetching sale" });
  }
});

// Void a sale: keeps the record (for audit), marks it voided and puts the stock back.
router.post("/:id/void", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Sale not found" });
  const reason = String((req.body && req.body.reason) || "").trim();
  if (!reason) return res.status(400).json({ message: "A reason is required to void a sale" });
  try {
    // Atomic: only one request can flip a sale to Voided, so stock is never restored twice.
    const sale = await SalesTransaction.findOneAndUpdate(
      { _id: req.params.id, paymentStatus: { $ne: "Voided" } },
      { paymentStatus: "Voided", voided: { at: new Date(), by: req.user && req.user._id, reason } },
      { new: true }
    );
    if (!sale) {
      const exists = await SalesTransaction.exists({ _id: req.params.id });
      return res.status(exists ? 409 : 404).json({ message: exists ? "Sale is already voided" : "Sale not found" });
    }
    await restock(sale.items);
    res.json({ message: "Sale voided and stock restored", sale });
  } catch (error) {
    console.error("Error voiding sale:", error);
    res.status(500).json({ message: "Error voiding sale" });
  }
});

// Sales can no longer be deleted; use void instead so there is always a record.
router.delete("/:id", (req, res) =>
  res.status(405).json({ message: "Sales cannot be deleted. Void the sale instead." })
);

module.exports = router;
