import React, { useState, useEffect } from 'react';
import axios from 'axios';
import EmployeeForm from '../../components/EmployeeForm/EmployeeForm';
import './employeePage.css';

function EmployeePage() {
    const [employees, setEmployees] = useState([]);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [totalPages, setTotalPages] = useState(0);
    const [sortBy, setSortBy] = useState('name');
    const [order, setOrder] = useState('asc');
    const [filter, setFilter] = useState('');

    // Fetch employees on mount
    useEffect(() => {
        fetchEmployees();
    }, [filter, sortBy, order, page, limit]); // Re-fetch when dependencies change

    const fetchEmployees = async () => {
        try {
            const response = await axios.get('/api/employees', {
                params: { page, limit, sortBy, order, filter },
            });
            setEmployees(response.data.employees);
            setTotalPages(response.data.totalPages);
        } catch (error) {
            console.error('Error fetching employees:', error);
        }
    };

    const handleAddEmployee = async (employee) => {
        console.log('Employee data being sent:', employee);
        try {
            await axios.post('/api/employees', employee);
            fetchEmployees();
            resetForm();
        } catch (error) {
            console.error('Error adding employee:', error);
        }
    };

    const handleUpdateEmployee = async (id, updatedData) => {
        try {
            const response = await axios.put(`/api/employees/${id}`, updatedData);
            const updatedEmployee = response.data;

            // Re-fetch employees to ensure table shows updated data
            fetchEmployees();
            resetForm(); // Reset form after updating
        } catch (error) {
            console.error('Error updating employee:', error);
        }
    };

    const handleDeleteEmployee = async (id) => {
        console.log(`Deleting employee with ID: ${id}`);
        try {
            await axios.delete(`/api/employees/${id}`);
            fetchEmployees();
        } catch (error) {
            console.error('Error deleting employee:', error);
        }
    };

    const resetForm = () => {
        setEditingEmployee(null);
    };

    return (
        <div className="employee-page">
            <h1>Employees</h1>

            <div className="page-content">
                <div className="content-container">
                    {/* Filter Input */}
                    <input
                        type="text"
                        placeholder="Filter by name or contact number..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />

                    {/* Sort By Selector */}
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        <option value="name">Name</option>
                        <option value="position">Position</option>
                        <option value="salary">Salary</option>
                        <option value="contactNumber">Contact Number</option>
                        <option value="email">Email</option>
                    </select>

                    {/* Sort Order Selector */}
                    <select value={order} onChange={(e) => setOrder(e.target.value)}>
                        <option value="asc">Ascending</option>
                        <option value="desc">Descending</option>
                    </select>

                    {/* Employee Table */}
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Position</th>
                                <th>Salary</th>
                                <th>Contact Number</th>
                                <th>Email</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {employees.length > 0 ? (
                                employees.map((employee) => (
                                    <tr key={employee._id}>
                                        <td>{employee.name}</td>
                                        <td>{employee.position}</td>
                                        <td>Rs.{employee.salary}</td>
                                        <td>{employee.contactNumber}</td>
                                        <td>{employee.email}</td>
                                        <td className="actions">
                                            <button onClick={() => setEditingEmployee(employee)}>
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDeleteEmployee(employee._id)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6">No employees found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>

                    {/* Pagination Controls */}
                    <div>
                        <button
                            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                            disabled={page === 1}
                        >
                            Previous
                        </button>
                        <span>
                            Page {page} of {totalPages}
                        </span>
                        <button
                            onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                            disabled={page === totalPages}
                        >
                            Next
                        </button>
                    </div>
                </div>

                {/* Employee Form */}
                <div className="employee-form-container">
                    <EmployeeForm
                        onSave={
                            editingEmployee
                                ? (data) => handleUpdateEmployee(editingEmployee._id, data)
                                : handleAddEmployee
                        }
                        editingEmployee={editingEmployee}
                        resetForm={resetForm}
                    />
                </div>
            </div>
        </div>
    );
}

export default EmployeePage;
