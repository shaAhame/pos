const express = require('express');
const router = express.Router();
const Customer = require('../models/customer');

// Create a customer
router.post('/', async (req, res) => {
  try {
    const newCustomer = new Customer(req.body);
    const savedCustomer = await newCustomer.save();
    res.status(201).json(savedCustomer); // Return the saved customer
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// Read customers with pagination, sorting, and filtering
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'name', order = 'asc', filter = '' } = req.query;

    const query = filter
    ? {
        $or: [
          { name: { $regex: filter, $options: 'i' } }, // Case-insensitive search in name
          { contactNumber: { $regex: filter, $options: 'i' } }, // Case-insensitive search in contact number
        ],
      }
    : {};    
    const customers = await Customer.find(query)
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Customer.countDocuments(query);
    
    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      customers,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a customer
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete a customer
router.delete('/:id', async (req, res) => {
  try {
    await Customer.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
