// const mongoose = require('mongoose');

// const productSchema = new mongoose.Schema({
//   name: { type: String, required: true },
//   category: { type: String, required: true },
//   quantity: { type: Number, required: true },
//   categoryCode: { type: String, unique: true }, 
//   prize: { type: String, required: true },
// });

// module.exports = mongoose.model('Product', productSchema);

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  barcode: { type: String, unique: true },
  quantity: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }, // Automatically records creation time
});

module.exports = mongoose.model('Product', productSchema);

