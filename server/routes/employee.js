const express = require('express');
const router = express.Router();
const Employee = require('../models/employee');

// Create an employee
router.post('/', async (req, res) => {
  try {
    const newEmployee = new Employee(req.body);
    const savedEmployee = await newEmployee.save();
    res.status(201).json(savedEmployee); // Return the saved employee
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// Read employees with pagination, sorting, and filtering
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
    const employees = await Employee.find(query)
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Employee.countDocuments(query);
    
    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      employees,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an employee
router.put('/:id', async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json(employee);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete an employee
router.delete('/:id', async (req, res) => {
  try {
    await Employee.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Employee deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
