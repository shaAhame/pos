const mongoose = require("mongoose");

const SalesTransactionSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: false,
  },
  items: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      quantity: { type: Number, required: true },
      price: { type: Number, required: true },
      total: { type: Number, required: true },
    },
  ],
  subtotal: { type: Number, required: true },  
  discount: { type: Number, default: 0 },  
  taxRate: { type: Number, default: 0 },  //  (Tax Percentage)
  taxAmount: { type: Number, default: 0 },   
  totalAmount: { type: Number, required: true },  // Final amount after calculations
  paymentStatus: { type: String, enum: ["Paid", "Unpaid", "Partial"], default: "Unpaid" },
  paymentMethod: { type: String, enum: ["Cash", "Card"], required: true },
  invoiceNumber: { type: String, unique: true },
  date: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SalesTransaction", SalesTransactionSchema);
