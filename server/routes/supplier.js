const express = require('express');
const router = express.Router();
const Supplier = require('../models/supplier');

// Create a supplier
router.post('/', async (req, res) => {
    try {
      const newSupplier = new Supplier(req.body);
      const savedSupplier = await newSupplier.save();
      res.status(201).json(savedSupplier); // Return the saved supplier
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: error.message });
    }
  });
  // Read suppliers with pagination, sorting, and filtering
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
      const suppliers = await Supplier.find(query)
        .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
  
      const total = await Supplier.countDocuments(query);
      
      res.status(200).json({
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        suppliers,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  // Update a supplier
router.put('/:id', async (req, res) => {
    try {
      const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true });
      res.status(200).json(supplier);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  
  // Delete a supplier
  router.delete('/:id', async (req, res) => {
    try {
      await Supplier.findByIdAndDelete(req.params.id);
      res.status(200).json({ message: 'Supplier deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  module.exports = router;
  