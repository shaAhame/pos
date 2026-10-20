/*const express = require("express");
const router = express.Router();
const SalesTransaction = require("../models/salesTransaction");


// Create a new sales transaction
router.post("/", async (req, res) => {
  try {
    const { customer, items, discount = 0, taxRate = 0,  paymentStatus, paymentMethod } = req.body;

    // Calculate subtotal (Sum of all items' total)
    //const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const subtotal = items.reduce((acc, item) => acc + item.total, 0);
    console.log("Subtotal:", subtotal); // Debugging log

    // Calculate discount amount
    const discountAmount = (subtotal * discount) / 100;

    // Calculate tax amount
    const taxAmount = ((subtotal - discountAmount) * taxRate) / 100;

    // Calculate final total amount
    const totalAmount = subtotal - discountAmount + taxAmount + shippingCharges;


    const invoiceNumber = "INV-" + Date.now();

    const newTransaction = new SalesTransaction({
      customer,
      items,
      subtotal,
      discount,
      taxRate,
      taxAmount,
      totalAmount,
      paymentStatus,
      paymentMethod,
      invoiceNumber,
    });

    await newTransaction.save();
    res.status(201).json({ message: "Transaction recorded successfully", newTransaction });
  } catch (error) {
    res.status(500).json({ message: "Error creating transaction", error });
  }
});

// Get all transactions
router.get("/", async (req, res) => {
  try {
    const transactions = await SalesTransaction.find().populate("customer").populate("items.product");
    res.status(200).json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching transactions", error });
  }
});
// Delete a sales transaction
router.delete("/:id",  async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await SalesTransaction.findByIdAndDelete(id);

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting transaction", error });
  }
});

// Get a single transaction by its ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Find the transaction by ID and populate customer and items
    const transaction = await SalesTransaction.findById(id)
      .populate("customer")
      .populate("items.product");

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    // Calculate subtotal (sum of all item totals)
    const subtotal = transaction.items.reduce((sum, item) => sum + item.total, 0);


    res.status(200).json(transaction);
  } catch (error) {
    res.status(500).json({ message: "Error fetching transaction", error });
  }
});


module.exports = router;
*/
const express = require("express");
const router = express.Router();
const SalesTransaction = require("../models/salesTransaction");

// Create a new sales transaction
router.post("/", async (req, res) => {
  try {
    const { customer, items, discount = 0, taxRate = 0, paymentStatus, paymentMethod, shippingCharges = 0 } = req.body;

    // Calculate subtotal (sum of all items' total)
    const subtotal = items.reduce((acc, item) => acc + item.total, 0);
    console.log("Subtotal:", subtotal); // Debugging log

    // Calculate discount amount
    const discountAmount = (subtotal * discount) / 100;

    // Calculate tax amount
    const taxAmount = ((subtotal - discountAmount) * taxRate) / 100;

    // Calculate final total amount
    const totalAmount = subtotal - discountAmount + taxAmount + shippingCharges;

    const invoiceNumber = "INV-" + Date.now();

    const newTransaction = new SalesTransaction({
      customer: customerId,
      items,
      subtotal,
      discount,
      taxRate,
      taxAmount,
      totalAmount,
      paymentStatus,
      paymentMethod,
      invoiceNumber,
    });

    await newTransaction.save();
    res.status(201).json({ message: "Transaction recorded successfully", newTransaction });
  } catch (error) {
    res.status(500).json({ message: "Error creating transaction", error });
  }
});

// Get all transactions
router.get("/", async (req, res) => {
  try {
    const transactions = await SalesTransaction.find().populate("customer").populate("items.product");
    res.status(200).json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching transactions", error });
  }
});

// Delete a sales transaction
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await SalesTransaction.findByIdAndDelete(id);

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting transaction", error });
  }
});

// Get a single transaction by its ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Find the transaction by ID and populate customer and items
    const transaction = await SalesTransaction.findById(id)
      .populate("customer")
      .populate("items.product");

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    // Calculate subtotal (sum of all item totals)
    const subtotal = transaction.items.reduce((sum, item) => sum + item.total, 0);

    // Return the response with calculated subtotal
    res.status(200).json({
      ...transaction.toObject(),
      subtotal, // Add calculated subtotal to the response
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching transaction", error });
  }
});

module.exports = router;

