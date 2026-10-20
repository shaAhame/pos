require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { migrate, getPool, close } = require("./lib/db");

const required = ["DATABASE_URL", "JWTPRIVATEKEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing settings in server/.env: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}
if (process.env.JWTPRIVATEKEY.length < 32 || process.env.JWTPRIVATEKEY === "change-me") {
  console.error("JWTPRIVATEKEY in server/.env must be a long random value (at least 32 characters).");
  process.exit(1);
}

const app = require("./app");

(async () => {
  try {
    await getPool().query("select 1");
    await migrate();
    console.log("Connected to database");
  } catch (err) {
    console.error("Database connection error:", err.message);
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 5000;
  const server = app.listen(port, () => console.log(`POS server running on http://localhost:${port}`));
  const shutdown = () => server.close(async () => { await close(); process.exit(0); });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
