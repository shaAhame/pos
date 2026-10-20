// const express = require('express');
// const router = express.Router();
// const Product = require('../models/product');
// const categoryBaseCodes = {
//   Electronics: "ELEC",
//   Clothing: "CLTH",
//   Food: "FOOD",
//   Furniture: "FURN",
// };

// router.post('/add', async (req, res) => {
//   try {
//     const { name, category, quantity, prize } = req.body;

//     // Validate the category
//     const baseCode = categoryBaseCodes[category];
//     if (!baseCode) {
//       return res.status(400).json({ error: 'Invalid category' });
//     }

//     // Count existing products in the same category
//     const count = await Product.countDocuments({ category });

//     // Generate a unique code for the category
//     const categoryCode = `${baseCode}-${(count + 1).toString().padStart(3, "0")}`;

//     // Create the new product with the generated categoryCode
//     const products = new Product({ name, category, quantity, categoryCode, prize });
//     await products.save();

//     res.status(201).json({ message: 'Product added successfully', product });
//   } catch (err) {
//     res.status(400).json({ error: err.message });
//   }
// });



// // Get all products
// router.get('/', async (req, res) => {
//   try {
//     const products = await Product.find();
//     res.status(200).json(products);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
 
// // Delete a product
// router.delete('/:id', async (req, res) => {
//   try {
//     await Product.findByIdAndDelete(req.params.id);
//     res.status(200).json({ message: 'Product deleted successfully' });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // Update a product
// router.put('/:id', async (req, res) => {
//   try {
//     const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
//     res.status(200).json({ message: 'Product updated successfully', product });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// module.exports = router;

const express = require('express');
const router = express.Router();
const Product = require('../models/product'); // Import the Product model

// Create a product
router.post('/', async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    const savedProduct = await newProduct.save();
    res.status(201).json(savedProduct);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Barcode already exists!' });
    } else {
      res.status(400).json({ error: error.message });
    }
  }
});


// Read products with pagination, sorting, and filtering
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'name', order = 'asc', filter = '' } = req.query;

    const query = filter
      ? {
          $or: [
            { name: { $regex: filter, $options: 'i' } }, // Case-insensitive search in name
            { description: { $regex: filter, $options: 'i' } }, // Case-insensitive search in description
          ],
        }
      : {};

    const products = await Product.find(query)
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(query);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      products,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a product
router.put('/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete a product
router.delete('/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
