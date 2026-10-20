import React, { useState, useEffect } from 'react';
import './employeeForm.css';

function EmployeeForm({ onSave, editingEmployee, resetForm }) {
    const [employee, setEmployee] = useState({ name: '', position: '', salary: '', contactNumber: '', email: '' });

    useEffect(() => {
        if (editingEmployee) {
            setEmployee(editingEmployee);
        } else {
            resetForm(); // Call resetForm when there's no editing employee
        }
    }, [editingEmployee, resetForm]);

    const handleChange = (e) => {
        setEmployee({ ...employee, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(employee);
        setEmployee({ name: '', position: '', salary: '', contactNumber: '', email: '' }); // Reset the form fields after saving
        resetForm(); // Clear editing state in parent
    };

    return (
        <form onSubmit={handleSubmit}>
            <input name="name" value={employee.name} onChange={handleChange} placeholder="Name" required />
             {/* Dropdown for selecting position */}
             <select
                name="position"
                value={employee.position}
                onChange={handleChange}
                required
            >
                <option value="" disabled>
                    Select Position
                </option>
                <option value="Admin">Admin</option>
                <option value="Accountant">Accountant</option>
                <option value="Cashier">Cashier</option>
                <option value="Manager">Manager</option>
                {/* Add more positions as needed */}
            </select>
            <input name="salary" value={employee.salary} onChange={handleChange} placeholder="Salary" required type="number" />
            <input name="contactNumber" value={employee.contactNumber} onChange={handleChange} placeholder="Contact Number" required />
            <input name="email" value={employee.email} onChange={handleChange} placeholder="Email" required />
            <button type="submit">Save</button>
        </form>
    );
}

export default EmployeeForm;
