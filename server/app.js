require("dotenv").config();
const express = require("express");
const cors = require("cors");
const auth = require("./middleware/auth");

const app = express();

app.use(express.json());
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(",") } : undefined));

// Public routes
app.use("/api/auth", require("./routes/auth"));   // login
app.use("/api/users", require("./routes/users")); // first-account setup is public; later accounts need login (checked inside)

// Everything below requires a valid login token
app.use("/api/employees", auth, require("./routes/employee"));
app.use("/api/customers", auth, require("./routes/customer"));
app.use("/api/suppliers", auth, require("./routes/supplier"));
app.use("/api/products", auth, require("./routes/product"));
app.use("/api/sales", auth, require("./routes/sales"));

module.exports = app;
