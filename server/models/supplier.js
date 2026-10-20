const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Supplier name
  company: { type: String, required: true }, // Contact person for the supplier
  contactNumber: { type: String, required: true }, // Contact number
  email: { type: String, required: true, unique: true }, // Supplier email
  address: { type: String, required: true }, // Address of the supplier
  //productsSupplied: { type: [String], required: true }, // List of product names supplied
});

module.exports = mongoose.model('Supplier', supplierSchema);
