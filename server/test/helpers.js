// Test helpers. Tests need their own throwaway PostgreSQL database:
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/pos_test npm test
// The database is WIPED at the start of every test file, so never point this at real data.
const request = require("supertest");

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to an EMPTY test database (it will be wiped). See README.");
  process.exit(1);
}
if (!/test/i.test(url) && process.env.ALLOW_DB_RESET !== "1") {
  console.error("Refusing to wipe a database whose URL doesn't contain 'test'. Set ALLOW_DB_RESET=1 to override.");
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.JWTPRIVATEKEY = process.env.JWTPRIVATEKEY || "test-secret-key-that-is-long-enough-123456";
process.env.SALT = "4";              // fast hashing in tests
process.env.LOGIN_RATE_LIMIT = "1000";

const db = require("../lib/db");
const { clearSettingsCache } = require("../lib/settings");
const app = require("../app");

const PASSWORD = "Str0ngPass!";

const resetDb = async () => {
  await db.query("drop schema public cascade; create schema public;");
  await db.migrate();
  clearSettingsCache();
};

// Creates owner + manager + cashier and returns request helpers for each.
const setupShop = async () => {
  await resetDb();
  const r = request(app);
  const setup = await r.post("/api/auth/setup").send({ firstName: "Olivia", lastName: "Owner", email: "owner@test.lk", password: PASSWORD, shopName: "Test Mart" });
  if (setup.status !== 201) throw new Error("setup failed: " + JSON.stringify(setup.body));
  const owner = as(setup.body.token);
  for (const [first, role] of [["Mia", "manager"], ["Carl", "cashier"]]) {
    const res = await owner.post("/api/users").send({ firstName: first, lastName: role, email: `${role}@test.lk`, password: PASSWORD, role });
    if (res.status !== 201) throw new Error("user create failed: " + JSON.stringify(res.body));
  }
  const login = async (email) => as((await r.post("/api/auth/login").send({ email, password: PASSWORD })).body.token);
  return { owner, manager: await login("manager@test.lk"), cashier: await login("cashier@test.lk"), raw: r };
};

// Small wrapper: as(token).get("/api/x")
const as = (token) => {
  const r = request(app);
  const wrap = (m) => (path) => r[m](path).set("Authorization", `Bearer ${token}`);
  return { token, get: wrap("get"), post: wrap("post"), put: wrap("put"), delete: wrap("delete") };
};

const mkProduct = async (user, data) => {
  const res = await user.post("/api/products").send({ category: "General", ...data });
  if (res.status !== 201) throw new Error("product create failed: " + JSON.stringify(res.body));
  return res.body;
};

const stockOf = async (id) => (await db.query("select quantity from products where id = $1", [id])).rows[0].quantity;

module.exports = { db, app, request, resetDb, setupShop, as, mkProduct, stockOf, PASSWORD };
