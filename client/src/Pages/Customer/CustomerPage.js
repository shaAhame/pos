import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CustomerForm from '../../components/CustomerForm/CustomerForm';
import './customerPage.module.css';

function CustomerPage() {
    const [customers, setCustomers] = useState([]);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [totalPages, setTotalPages] = useState(0);
    const [sortBy, setSortBy] = useState('name');
    const [order, setOrder] = useState('asc');
    const [filter, setFilter] = useState('');

    // Fetch customers on mount
    useEffect(() => {
        fetchCustomers();
    }, [filter, sortBy, order, page, limit]); // Re-fetch when dependencies change

    const fetchCustomers = async () => {
        try {
            const response = await axios.get('/api/customers', {
                params: { page, limit, sortBy, order, filter },
            });
            setCustomers(response.data.customers);
            setTotalPages(response.data.totalPages);
        } catch (error) {
            console.error('Error fetching customers:', error);
        }
    };

    const handleAddCustomer = async (customer) => {
        try {
            await axios.post('/api/customers', customer);
            fetchCustomers();
            resetForm();
        } catch (error) {
            console.error('Error adding customer:', error);
        }
    };

    const handleUpdateCustomer = async (id, updatedData) => {
        try {
            await axios.put(`/api/customers/${id}`, updatedData);
            fetchCustomers();
            resetForm();
        } catch (error) {
            console.error('Error updating customer:', error);
        }
    };

    const handleDeleteCustomer = async (id) => {
        try {
            await axios.delete(`/api/customers/${id}`);
            fetchCustomers();
        } catch (error) {
            console.error('Error deleting customer:', error);
        }
    };

    const resetForm = () => {
        setEditingCustomer(null);
    };

    return (
        <div className="customer-page">
            <h1>Customers</h1>

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
                        <option value="contactNumber">Contact Number</option>
                        <option value="email">Email</option>
                    </select>

                    {/* Sort Order Selector */}
                    <select value={order} onChange={(e) => setOrder(e.target.value)}>
                        <option value="asc">Ascending</option>
                        <option value="desc">Descending</option>
                    </select>

                    {/* Customer Table */}
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Contact Number</th>
                                <th>Email</th>
                                <th>Address</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {customers.length > 0 ? (
                                customers.map((customer) => (
                                    <tr key={customer._id}>
                                        <td>{customer.name}</td>
                                        <td>{customer.contactNumber}</td>
                                        <td>{customer.email}</td>
                                        <td>{customer.address}</td>
                                        <td className="actions">
                                            <button onClick={() => setEditingCustomer(customer)}>
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDeleteCustomer(customer._id)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="4">No customers found.</td>
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

                {/* Customer Form */}
                <div className="customer-form-container">
                    <CustomerForm
                        onSave={
                            editingCustomer
                                ? (data) => handleUpdateCustomer(editingCustomer._id, data)
                                : handleAddCustomer
                        }
                        editingCustomer={editingCustomer}
                        resetForm={resetForm}
                    />
                </div>
            </div>
        </div>
    );
}

export default CustomerPage;
