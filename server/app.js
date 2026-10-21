const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { requireAuth, requireRole, requireFeature } = require("./middleware/auth");
const { withLocation } = require("./lib/location");
const { errorHandler } = require("./lib/errors");
const { query } = require("./lib/db");

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);
app.disable("x-powered-by");

// Note: no "upgrade-insecure-requests" / HSTS, because other tills in the shop often open the
// app over the local network as plain http://192.168.x.x, and forcing https would break it.
app.use(helmet({
  contentSecurityPolicy: { directives: { "img-src": ["'self'", "data:"], "upgrade-insecure-requests": null } },
  strictTransportSecurity: false,
}));
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "1mb" }));

// Health check (for hosting platforms / monitoring)
app.get("/api/health", async (req, res) => {
  try { await query("select 1"); res.json({ ok: true, db: "up" }); }
  catch { res.status(503).json({ ok: false, db: "down" }); }
});

const { router: authRouter } = require("./routes/auth");
const people = require("./routes/people");
const either = (...names) => (req, res, next) =>
  names.some((n) => req.business.features[n]) ? next() : res.status(403).json({ message: "This feature isn't switched on for your business", code: "FEATURE_OFF" });

app.use("/api/auth", authRouter);
app.use("/api/platform", require("./routes/platform"));   // MacQuad admins (separate login)

// Everything below needs a logged-in shop user of an active business (and knows the branch).
app.use("/api", requireAuth, withLocation);
app.use("/api/settings", require("./routes/settings"));
app.use("/api/users", (req, res, next) => (req.path === "/approvers" ? next() : requireRole("owner")(req, res, next)), require("./routes/users"));
app.use("/api/locations", require("./routes/locations"));
app.use("/api/transfers", require("./routes/transfers"));
app.use("/api/employees", people.employees);
app.use("/api/customers", people.customers);
app.use("/api/suppliers", people.suppliers);
app.use("/api/products", require("./routes/products"));
app.use("/api/shifts", require("./routes/shifts").router);
app.use("/api/sales", require("./routes/sales"));
app.use("/api/reports", requireRole("manager"), require("./routes/reports"));
app.use("/api/serials", either("serials", "warranty"), require("./routes/serials"));
app.use("/api/repairs", requireFeature("repairs"), require("./routes/repairs"));
app.use("/api/claims", requireFeature("supplierClaims"), requireRole("manager"), require("./routes/claims"));
app.use("/api/installments", requireFeature("installments"), require("./routes/installments"));
app.use("/api/orders", requireFeature("orders"), require("./routes/orders"));

app.use("/api", (req, res) => res.status(404).json({ message: "Not found" }));

// In production the server also serves the built React app.
const clientBuild = process.env.CLIENT_DIST || path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(path.join(clientBuild, "index.html"))) {
  app.use(express.static(clientBuild, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(clientBuild, "index.html")));
}

app.use(errorHandler);

module.exports = app;
