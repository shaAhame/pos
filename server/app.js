const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { requireAuth, requireRole } = require("./middleware/auth");
const { errorHandler } = require("./lib/errors");
const { query } = require("./lib/db");

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);
app.disable("x-powered-by");

app.use(helmet({ contentSecurityPolicy: { directives: { "img-src": ["'self'", "data:"] } } }));
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "1mb" }));

// Health check (for hosting platforms / monitoring)
app.get("/api/health", async (req, res) => {
  try { await query("select 1"); res.json({ ok: true, db: "up" }); }
  catch { res.status(503).json({ ok: false, db: "down" }); }
});

const { router: authRouter } = require("./routes/auth");
const people = require("./routes/people");

app.use("/api/auth", authRouter);

// Everything below needs a logged-in, active user.
app.use("/api", requireAuth);
app.use("/api/settings", require("./routes/settings"));
app.use("/api/users", requireRole("owner"), require("./routes/users"));
app.use("/api/employees", people.employees);
app.use("/api/customers", people.customers);
app.use("/api/suppliers", people.suppliers);
app.use("/api/products", require("./routes/products"));
app.use("/api/shifts", require("./routes/shifts").router);
app.use("/api/sales", require("./routes/sales"));
app.use("/api/reports", requireRole("manager"), require("./routes/reports"));

app.use("/api", (req, res) => res.status(404).json({ message: "Not found" }));

// In production the server also serves the built React app.
const clientBuild = process.env.CLIENT_DIST || path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(path.join(clientBuild, "index.html"))) {
  app.use(express.static(clientBuild, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(clientBuild, "index.html")));
}

app.use(errorHandler);

module.exports = app;
