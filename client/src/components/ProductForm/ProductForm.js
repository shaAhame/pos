import React, { useState, useEffect } from 'react';
import './productForm.module.css'; // Update the CSS filename

function ProductForm({ onSave, editingProduct, resetForm, scannedBarcode }) {
    const [product, setProduct] = useState({
      name: '',
      price: '',
      quantity: '',
      description: '',
      category: '',
      barcode: '',
    });
  
    useEffect(() => {
      if (editingProduct) {
        setProduct(editingProduct);
      } else {
        resetForm(); // Reset form when there's no editing product
      }
    }, [editingProduct, resetForm]);
  
    // Update barcode field when a barcode is scanned
    useEffect(() => {
      if (scannedBarcode) {
        setProduct((prev) => ({ ...prev, barcode: scannedBarcode }));
      }
    }, [scannedBarcode]);
  
    const handleChange = (e) => {
      setProduct({ ...product, [e.target.name]: e.target.value });
    };
  
    const handleSubmit = (e) => {
      e.preventDefault();
      onSave(product);
      setProduct({
        name: '',
        price: '',
        quantity: '',
        description: '',
        category: '',
        barcode: '',
      });
      resetForm();
    };

    return (
        <form onSubmit={handleSubmit}>
            <input
                name="name"
                value={product.name}
                onChange={handleChange}
                placeholder="Product Name"
                required
            />
            <input
                name="price"
                value={product.price}
                onChange={handleChange}
                placeholder="Price"
                required
                type="number"
                min="0"
                step="0.01"
            />
            <input
                name="quantity"
                value={product.quantity}
                onChange={handleChange}
                placeholder="Quantity"
                required
                type="number"
                min="0"
            />
            <textarea
                name="description"
                value={product.description}
                onChange={handleChange}
                placeholder="Product Description"
                required
            />
            <input
                name="barcode"
                type="text"
                value={product.barcode}
                onChange={handleChange}
                placeholder="Scan or enter barcode"  
            />

            <input
                name="category"
                value={product.category}
                onChange={handleChange}
                placeholder="Category"
                required
            />


            <button type="submit">Save</button>
        </form>
    );
}

export default ProductForm;