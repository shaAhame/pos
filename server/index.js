require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const connection = require("./db");  
const mongoose = require('mongoose');


// Import Routes
const userRoutes = require("./routes/users");
const authRoutes = require("./routes/auth");
const employeeRoutes = require("./routes/employee");
const customerRoutes = require("./routes/customer"); 
const supplierRoutes = require("./routes/supplier");
const productRoutes = require("./routes/product");
const saleRoutes = require("./routes/sales");

 

// Connect to the database
connection();  

// Middlewares
app.use(express.json());
app.use(cors());

// Use Routes
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);

 

// API Test Route
app.get("/api", (req, res) => {
  res.json({ "users": ["user1"] });
});

// Sample Login Route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const userDoc = await User.findOne({ email });

  if (userDoc) {
    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (passOk) {
      jwt.sign({
        email: userDoc.email,
        id: userDoc._id,
      }, jwtSecret, (err, token) => {
        if (err) throw err;
        res.cookie('token', token, { httpOnly: true }).json(userDoc);
      });
    } else {
      res.status(422).json('Password not correct');
    }
  } else {
    res.status(404).json('User not found');
  }
});

// Start the Server
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Listening on port ${port}...`));
