import React, { useState, useEffect } from 'react';
import './customerForm.module.css'; // Update the CSS filename

function CustomerForm({ onSave, editingCustomer, resetForm }) {
    const [customer, setCustomer] = useState({
        name: '',
        email: '',
        contactNumber: '',
        address: '',
    });

    useEffect(() => {
        if (editingCustomer) {
            setCustomer(editingCustomer);
        } else {
            resetForm(); // Reset form when there's no editing customer
        }
    }, [editingCustomer, resetForm]);

    const handleChange = (e) => {
        setCustomer({ ...customer, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(customer);
        setCustomer({ name: '', email: '', contactNumber: '', address: '' }); // Reset form fields after saving
        resetForm(); // Clear editing state in parent
    };

    return (
        <form onSubmit={handleSubmit}>
            <input
                name="name"
                value={customer.name}
                onChange={handleChange}
                placeholder="Customer Name"
                required
            />
            <input
                name="email"
                value={customer.email}
                onChange={handleChange}
                placeholder="Email Address"
                required
                type="email"
            />
            <input
                name="contactNumber"
                value={customer.contactNumber}
                onChange={handleChange}
                placeholder="Contact Number"
                required
                type="tel"
            />
            <input
                name="address"
                value={customer.address}
                onChange={handleChange}
                placeholder="Address"
                required
            />

            <button type="submit">Save</button>
        </form>
    );
}

export default CustomerForm;
