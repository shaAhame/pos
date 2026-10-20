// import React, { useState, useEffect } from 'react';
// import AddProduct from '../../components/AddProduct/AddProduct';
// function Products() {
//   const [products, setProducts] = useState([]);

//   // Fetch products from the database
//   useEffect(() => {
//     const fetchProducts = async () => {
//       try {
//         const response = await fetch('http://localhost:5000/api/products');
//         if (response.ok) {
//           const data = await response.json();
//           setProducts(data); // Update the state with the fetched products
//         } else {
//           console.error('Failed to fetch products');
//         }
//       } catch (error) {
//         console.error('Error:', error);
//       }
//     };

//     fetchProducts(); // Fetch products when the component is mounted
//   }, []);

//   return (


//     <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)' }}>
//       <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Products</h2>
//       <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
//         <thead>
//           <tr>
//             <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Name</th>
//             <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Quantity</th>
//             <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Category</th>
//             <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Category Code</th>
//             <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Prize</th>
//           </tr>
//         </thead>
//         <tbody>
//           {products.map((product) => (
//             <tr key={product.id}>
//               <td style={{ border: '1px solid #ccc', padding: '8px' }}>{product.name}</td>
//               <td style={{ border: '1px solid #ccc', padding: '8px' }}>{product.quantity}</td>
//               <td style={{ border: '1px solid #ccc', padding: '8px' }}>{product.category}</td>
//               <td style={{ border: '1px solid #ccc', padding: '8px' }}>{product.categoryCode}</td>
//               <td style={{ border: '1px solid #ccc', padding: '8px' }}>{product.prize}</td>
//             </tr>
//           ))}
//         </tbody>
//       </table>
//     </div>
//   );
// }

// export default Products;
