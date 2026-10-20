import React, { useState, useEffect } from 'react';
import './supplierForm.css';

function SupplierForm({ onSave, editingSupplier, resetForm }) {
    const [supplier, setSupplier] = useState({ 
        name: '', 
        company: '', 
        contactNumber: '', 
        email: '', 
        address: '' 
    });

    useEffect(() => {
        if (editingSupplier) {
            setSupplier(editingSupplier);
        } else {
            setSupplier({ name: '', company: '', contactNumber: '', email: '', address: '' });
        }
    }, [editingSupplier]);

    const handleChange = (e) => {
        setSupplier({ ...supplier, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(supplier);
        setSupplier({ name: '', company: '', contactNumber: '', email: '', address: '' }); // Reset form fields
        resetForm(); // Clear editing state in parent
    };

    return (
        <form onSubmit={handleSubmit}>
            <input 
                name="name" 
                value={supplier.name} 
                onChange={handleChange} 
                placeholder="Supplier Name" 
                required 
                type="text"
            />
            <input 
                name="company" 
                value={supplier.company} 
                onChange={handleChange} 
                placeholder="Company Name" 
                required 
                type="text"
            />
            <input 
                name="contactNumber" 
                value={supplier.contactNumber} 
                onChange={handleChange} 
                placeholder="Contact Number" 
                required 
                type="tel"
                pattern="[0-9]+" // Ensures only numbers are entered
                title="Contact number should contain only digits."
            />
            <input 
                name="email" 
                value={supplier.email} 
                onChange={handleChange} 
                placeholder="Email" 
                required 
                type="email"
            />
            <input 
                name="address" 
                value={supplier.address} 
                onChange={handleChange} 
                placeholder="Address" 
                required 
                type="text"
            />
            <button type="submit">Save</button>
        </form>
    );
}

export default SupplierForm;
