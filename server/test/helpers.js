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
process.env.SALT = "4";
process.env.LOGIN_RATE_LIMIT = "100000";

const db = require("../lib/db");
const { clearSettingsCache } = require("../lib/settings");
const app = require("../app");

const PASSWORD = "Str0ngPass!";
let seq = 0;

const resetDb = async () => {
  await db.query("drop schema public cascade; create schema public;");
  await db.migrate();
  clearSettingsCache();
};

// Small wrapper: as(token).get("/api/x")
const as = (token) => {
  const r = request(app);
  const wrap = (m) => (path) => r[m](path).set("Authorization", `Bearer ${token}`);
  return { token, get: wrap("get"), post: wrap("post"), put: wrap("put"), delete: wrap("delete") };
};

// The MacQuad admin (created once per test file).
const platformAdmin = async () => {
  const r = request(app);
  let res = await r.post("/api/platform/setup").send({ name: "Mac Admin", email: "admin@macquad.lk", password: PASSWORD });
  if (res.status === 409) res = await r.post("/api/platform/login").send({ email: "admin@macquad.lk", password: PASSWORD });
  if (![200, 201].includes(res.status)) throw new Error("platform setup failed: " + JSON.stringify(res.body));
  return as(res.body.token);
};

// Creates a business (via the platform) with owner + manager + cashier and returns request helpers for each.
const setupShop = async ({ reset = true, type = "grocery", name = "Test Mart", features } = {}) => {
  if (reset) await resetDb();
  const admin = await platformAdmin();
  const n = ++seq;
  const ownerEmail = `owner${n}@test.lk`;
  const biz = await admin.post("/api/platform/businesses").send({
    name, type, features, owner: { firstName: "Olivia", lastName: "Owner", email: ownerEmail, password: PASSWORD },
  });
  if (biz.status !== 201) throw new Error("business create failed: " + JSON.stringify(biz.body));
  const r = request(app);
  const login = async (email) => {
    const res = await r.post("/api/auth/login").send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error("login failed: " + JSON.stringify(res.body));
    return as(res.body.token);
  };
  const owner = await login(ownerEmail);
  for (const [first, role] of [["Mia", "manager"], ["Carl", "cashier"]]) {
    const res = await owner.post("/api/users").send({ firstName: first, lastName: role, email: `${role}${n}@test.lk`, password: PASSWORD, role });
    if (res.status !== 201) throw new Error("user create failed: " + JSON.stringify(res.body));
  }
  return {
    admin, business: biz.body, owner, raw: r, n,
    manager: await login(`manager${n}@test.lk`), cashier: await login(`cashier${n}@test.lk`),
    emails: { owner: ownerEmail, manager: `manager${n}@test.lk`, cashier: `cashier${n}@test.lk` },
  };
};

const mkProduct = async (user, data) => {
  const res = await user.post("/api/products").send({ category: "General", ...data });
  if (res.status !== 201) throw new Error("product create failed: " + JSON.stringify(res.body));
  return res.body;
};

const stockOf = async (id, locationId = null) =>
  (await db.query("select coalesce(sum(quantity),0)::int q from product_stock where product_id = $1 and ($2::uuid is null or location_id = $2::uuid)", [id, locationId])).rows[0].q;

const serialStatus = async (serial) => (await db.query("select status from serials where upper(serial) = upper($1)", [serial])).rows[0]?.status;

module.exports = { db, app, request, resetDb, setupShop, platformAdmin, as, mkProduct, stockOf, serialStatus, PASSWORD };
