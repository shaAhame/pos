require("dotenv").config();
const mongoose = require("mongoose");

const connection = async () => {
  const dbURI = process.env.MONGO_URI || "mongodb+srv://MAM_store:LAyrGeb0o8F9xC6q@cluster0.f5g0i.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

  try {
    await mongoose.connect(dbURI); // No options needed for modern Mongoose versions
    console.log("Connected to cloud database");
  } catch (err) {
    console.error("Database connection error:", err.message);
    process.exit(1); // Exit process on failure
  }
};

module.exports = connection;
