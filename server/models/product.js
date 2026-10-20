const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  // Optional; empty values are stored as "no barcode" so several products can lack one.
  barcode: {
    type: String,
    trim: true,
    set: (v) => (v === '' || v === null ? undefined : v),
  },
  quantity: { type: Number, required: true, min: 0 },
  createdAt: { type: Date, default: Date.now },
});

productSchema.index({ barcode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Product', productSchema);
