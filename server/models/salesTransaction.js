const mongoose = require("mongoose");

const SalesTransactionSchema = new mongoose.Schema({
  // Registered customer (optional) ...
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: false },
  // ... or just a name for walk-in customers.
  customerName: { type: String, default: "Walk-in Customer" },
  items: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      name: { type: String, required: true }, // snapshot, so old invoices survive product edits/deletes
      quantity: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true },
      total: { type: Number, required: true },
    },
  ],
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },       // percent
  discountAmount: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },        // percent
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  paymentStatus: { type: String, enum: ["Paid", "Unpaid", "Partial", "Voided"], default: "Paid" },
  paymentMethod: { type: String, enum: ["Cash", "Card"], required: true },
  invoiceNumber: { type: String, unique: true },
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  voided: {
    at: Date,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reason: String,
  },
  date: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SalesTransaction", SalesTransactionSchema);
