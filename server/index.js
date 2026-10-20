require("dotenv").config();
const { connection } = require("./db");
const app = require("./app");

if (!process.env.JWTPRIVATEKEY) {
  console.error("JWTPRIVATEKEY is not set. Copy server/.env.example to server/.env and fill it in.");
  process.exit(1);
}

connection();

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Listening on port ${port}...`));
