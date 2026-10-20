import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import Main from './components/Main';
import Signup from './components/Signup';
import Login from './components/Login';
import Sidebar from './components/Sidebar/Sidebar';
import Dashboard from './Pages/Dashboard/Dashboard';
import EmployeePage from './Pages/Employee/EmployeePage';
import CustomerPage from './Pages/Customer/CustomerPage';
import SupplierPage from './Pages/Supplier/SupplierPage';
import ProductPage from './Pages/Product/ProductPage';
import SalesPage from './Pages/Sales/SalesPage';
import BillsPage from './Pages/Bills/BillsPage';
import InvoicePage from "./Pages/Invoice/InvoicePage"; 

function App() {
  const [backendData, setBackendData] = useState([{}]);

  useEffect(() => {
    fetch("/").then(
      response => response.json()
    ).then(
      data => {
        setBackendData(data);
      }
    );
  }, []);

  const user = localStorage.getItem("token");

  return (
    <Router>
      <div className="app-container" style={{ display: 'flex' }}>
        {/* Conditionally render Sidebar if the user is logged in */}
        {user && <Sidebar />}

        <div className="content-container" style={{ marginLeft: user ? '250px' : '0', flex: 1 }}>
          {/* Main Page Route - Always render Main component */}
          <Main />

          <div style={{ marginTop: '60px' }}> {/* Add a margin to push content below Main */}
            <Routes>
              {/* If the user is authenticated, show routes */}
              {user ? (
                <>
                <Route path="/dashboard" element={<Dashboard/>}></Route>
                <Route path="/employees" element={<EmployeePage/>}></Route>
                <Route path="/sales" element={<SalesPage/>}></Route>
                <Route path="/bills" element={<BillsPage/>}></Route>
                <Route path="/customer" element={<CustomerPage/>}></Route>
                <Route path="/supplier" element={<SupplierPage/>}></Route>
                <Route path="/product" element={<ProductPage/>}></Route>
                <Route path="/invoice/:id" element={<InvoicePage />} ></Route>
            </>
              ) : (
                <>
                  {/* Redirect to login if user is not authenticated */}
                  <Route path="/" element={<Navigate replace to="/login" />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/login" element={<Login />} />
                </>
              )}
            </Routes>
          </div>
        </div>
      </div>
    </Router>
  );
}

export default App;
