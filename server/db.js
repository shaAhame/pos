require("dotenv").config();
const mongoose = require("mongoose");

const connection = async () => {
  const dbURI = process.env.MONGO_URI;
  if (!dbURI) {
    console.error("MONGO_URI is not set. Copy server/.env.example to server/.env and fill it in.");
    process.exit(1);
  }

  try {
    await mongoose.connect(dbURI);
    console.log("Connected to database");
  } catch (err) {
    console.error("Database connection error:", err.message);
    process.exit(1);
  }
};

module.exports = connection;
