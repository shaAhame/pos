const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, request, app, setupShop, as, PASSWORD } = require("./helpers");

let shop;
before(async () => { shop = await setupShop(); });
after(() => db.close());

test("platform setup only works once; shops are created by the platform admin", async () => {
  const r = request(app);
  assert.equal((await r.get("/api/auth/status")).body.needsPlatformSetup, false);
  const again = await r.post("/api/platform/setup").send({ name: "X", email: "x@y.lk", password: PASSWORD });
  assert.equal(again.status, 409);
  assert.equal((await r.post("/api/auth/setup").send({ firstName: "X", lastName: "Y", email: "x@y.lk", password: PASSWORD })).status, 401);
});

test("a new business gets its owner, settings and first branch", async () => {
  const s = (await shop.owner.get("/api/settings")).body;
  assert.equal(s.shopName, "Test Mart");
  const locs = (await shop.owner.get("/api/locations")).body;
  assert.equal(locs.length, 1);
  assert.equal(locs[0].name, "Main store");
  const me = (await shop.owner.get("/api/auth/me")).body;
  assert.equal(me.business.name, "Test Mart");
  assert.equal(me.business.type, "grocery");
  assert.equal(me.business.features.splitPayments, true);
  assert.equal(me.business.features.serials, false);
});

test("every API route needs login", async () => {
  const r = request(app);
  for (const p of ["/api/products", "/api/sales", "/api/customers", "/api/employees", "/api/suppliers", "/api/users", "/api/reports/summary", "/api/shifts/current", "/api/settings"]) {
    assert.equal((await r.get(p)).status, 401, p);
  }
  assert.equal((await r.get("/api/products").set("Authorization", "Bearer nonsense")).status, 401);
});

test("login: case-insensitive email, wrong password rejected", async () => {
  const r = request(app);
  assert.equal((await r.post("/api/auth/login").send({ email: shop.emails.owner.toUpperCase(), password: PASSWORD })).status, 200);
  assert.equal((await r.post("/api/auth/login").send({ email: shop.emails.owner, password: "wrong" })).status, 401);
  assert.equal((await r.post("/api/auth/login").send({ email: "nobody@test.lk", password: "wrong" })).status, 401);
});

test("/me returns the user and role", async () => {
  const me = await shop.cashier.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.role, "cashier");
  assert.equal(me.body.password, undefined);
});

test("role permissions", async () => {
  const { owner, manager, cashier } = shop;
  // owner-only
  assert.equal((await manager.get("/api/users")).status, 403);
  assert.equal((await manager.get("/api/employees")).status, 403);
  assert.equal((await manager.put("/api/settings").send({ shopName: "X" })).status, 403);
  assert.equal((await owner.get("/api/employees")).status, 200);
  // manager+
  assert.equal((await cashier.get("/api/reports/summary")).status, 403);
  assert.equal((await cashier.get("/api/suppliers")).status, 403);
  assert.equal((await cashier.post("/api/products").send({ name: "X", category: "Y", price: 1 })).status, 403);
  assert.equal((await manager.get("/api/reports/summary")).status, 200);
  // cashier allowed
  assert.equal((await cashier.get("/api/products")).status, 200);
  assert.equal((await cashier.get("/api/customers")).status, 200);
  assert.equal((await cashier.get("/api/settings")).status, 200);
});

test("disabling a user locks them out immediately", async () => {
  const { owner, raw } = shop;
  const u = await owner.post("/api/users").send({ firstName: "Tmp", lastName: "User", email: "tmp@test.lk", password: PASSWORD, role: "cashier" });
  const tok = (await raw.post("/api/auth/login").send({ email: "tmp@test.lk", password: PASSWORD })).body.token;
  assert.equal((await as(tok).get("/api/auth/me")).status, 200);
  await owner.put(`/api/users/${u.body._id}`).send({ active: false });
  assert.equal((await as(tok).get("/api/auth/me")).status, 401);
  assert.equal((await raw.post("/api/auth/login").send({ email: "tmp@test.lk", password: PASSWORD })).status, 403);
});

test("role change takes effect without logging in again", async () => {
  const { owner, cashier } = shop;
  const me = (await cashier.get("/api/auth/me")).body;
  await owner.put(`/api/users/${me._id}`).send({ role: "manager" });
  assert.equal((await cashier.get("/api/reports/summary")).status, 200);
  await owner.put(`/api/users/${me._id}`).send({ role: "cashier" });
  assert.equal((await cashier.get("/api/reports/summary")).status, 403);
});

test("the last owner can't be demoted or disabled", async () => {
  const { owner } = shop;
  const me = (await owner.get("/api/auth/me")).body;
  assert.equal((await owner.put(`/api/users/${me._id}`).send({ role: "manager" })).status, 400);
  assert.equal((await owner.put(`/api/users/${me._id}`).send({ active: false })).status, 400);
});

test("duplicate staff email is rejected", async () => {
  const res = await shop.owner.post("/api/users").send({ firstName: "A", lastName: "B", email: shop.emails.cashier.toUpperCase(), password: PASSWORD });
  assert.equal(res.status, 409);
});

test("change own password", async () => {
  const { manager, raw } = shop;
  assert.equal((await manager.post("/api/auth/password").send({ currentPassword: "nope", newPassword: "NewPass123!" })).status, 400);
  assert.equal((await manager.post("/api/auth/password").send({ currentPassword: PASSWORD, newPassword: "NewPass123!" })).status, 200);
  assert.equal((await raw.post("/api/auth/login").send({ email: shop.emails.manager, password: "NewPass123!" })).status, 200);
});

test("settings: validation and owner update", async () => {
  const { owner, cashier } = shop;
  assert.equal((await owner.put("/api/settings").send({ timezone: "Mars/Base" })).status, 400);
  assert.equal((await owner.put("/api/settings").send({ maxCashierDiscount: 150 })).status, 400);
  const res = await owner.put("/api/settings").send({ shopName: "MAM Stores", phone: "+94 77 000 0000", maxCashierDiscount: 5 });
  assert.equal(res.status, 200);
  assert.equal((await cashier.get("/api/settings")).body.maxCashierDiscount, 5);
});
