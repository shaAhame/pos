// import React, { useState } from 'react';

// const AddProduct = () => {
//   const [name, setName] = useState('');
//   const [quantity, setQuantity] = useState('');
//   const [category, setCategory] = useState('Electronics');
//   const [prize, setPrize] = useState('');
//   const [error, setError] = useState('');
//   const [successMessage, setSuccessMessage] = useState('');

//   const categoryBaseCodes = {
//     Electronics: 'ELEC',
//     Clothing: 'CLTH',
//     Food: 'FOOD',
//     Furniture: 'FURN',
//   };

//   const handleSubmit = async (e) => {
//     e.preventDefault();

//     setError('');
//     setSuccessMessage('');

//     if (!name || !quantity || !category || !prize) {
//       setError('All fields are required.');
//       return;
//     }

//     try {
//       const response = await fetch('http://localhost:5000/api/products', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({ name, quantity, category, prize }),
//       });

//       const data = await response.json();

//       if (response.ok) {
//         setSuccessMessage('Product added successfully!');
//         setName('');
//         setQuantity('');
//         setCategory('Electronics');
//         setPrize('');
//       } else {
//         setError(data.error || 'An error occurred while adding the product.');
//       }
//     } catch (err) {
//       console.error('Error submitting form:', err);
//       setError('An error occurred while adding the product.');
//     }
//   };

//   return (
//     <div className="form-container">
//       <h2>Add Product</h2>
//       {error && <div className="error">{error}</div>}
//       {successMessage && <div className="success">{successMessage}</div>}
//       <form onSubmit={handleSubmit}>
//         <label htmlFor="name">Product Name</label>
//         <input
//           type="text"
//           id="name"
//           value={name}
//           onChange={(e) => setName(e.target.value)}
//           required
//         />

//         <label htmlFor="quantity">Quantity</label>
//         <input
//           type="number"
//           id="quantity"
//           value={quantity}
//           onChange={(e) => setQuantity(e.target.value)}
//           required
//         />

//         <label htmlFor="prize">Prize</label>
//         <input
//           type="text"
//           id="prize"
//           value={prize}
//           onChange={(e) => setPrize(e.target.value)}
//           required
//         />

//         <label htmlFor="category">Category</label>
//         <select
//           id="category"
//           value={category}
//           onChange={(e) => setCategory(e.target.value)}
//           required
//         >
//           {Object.keys(categoryBaseCodes).map((cat) => (
//             <option key={cat} value={cat}>
//               {cat}
//             </option>
//           ))}
//         </select>

//         <button type="submit">Add Product</button>
//       </form>
//     </div>
//   );
// };

// export default AddProduct;
