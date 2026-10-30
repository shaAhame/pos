// Single-shop mode: the shop, its branches and the owner are created from environment
// settings on first start, and never touched again.
const test = require("node:test");
const assert = require("node:assert/strict");
const { app, resetDb, as, request, PASSWORD } = require("./helpers");
const { autoSetup, readConfig, platformEnabled } = require("../lib/setup");

const ENV = {
  SHOP_NAME: "Idealz Lanka",
  SHOP_TYPE: "electronics",
  OWNER_EMAIL: "Owner@Idealz.LK",
  OWNER_PASSWORD: PASSWORD,
  OWNER_NAME: "Shakeeb Ahamed",
  BRANCHES: "Colombo, Kandy ,Galle",
  WAREHOUSES: "Main warehouse",
  SHOP_PHONE: "077 866 2627",
  SHOP_CURRENCY: "Rs.",
};

test("reads and checks the settings before touching the database", () => {
  assert.equal(readConfig({}), null, "no SHOP_NAME means no single-shop mode");

  assert.throws(() => readConfig({ ...ENV, SHOP_TYPE: "bakery" }), /SHOP_TYPE/);
  assert.throws(() => readConfig({ ...ENV, OWNER_EMAIL: "not-an-email" }), /OWNER_EMAIL/);
  assert.throws(() => readConfig({ ...ENV, OWNER_PASSWORD: "short" }), /8 characters/);
  assert.throws(() => readConfig({ ...ENV, OWNER_PASSWORD: "alllowercase" }), /capital letters/);
  assert.throws(() => readConfig({ ...ENV, BRANCHES: "Colombo, Colombo" }), /different from each other/);

  const cfg = readConfig(ENV);
  assert.deepEqual(cfg.branches, ["Colombo", "Kandy", "Galle"], "spaces around commas are trimmed");
  assert.equal(cfg.email, "owner@idealz.lk", "email is stored lower case");
  assert.equal(cfg.firstName, "Shakeeb");
  assert.equal(cfg.lastName, "Ahamed");

  assert.equal(readConfig({ ...ENV, BRANCHES: "" }).branches[0], "Main shop", "there is always one shop");
});

test("creates the shop, branches and owner on first start", async () => {
  await resetDb();
  const result = await autoSetup(ENV);
  assert.equal(result.created, true);
  assert.equal(result.branches.length, 4);

  // The owner can log in with the password from the environment.
  const login = await request(app).post("/api/auth/login").send({ email: "owner@idealz.lk", password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const owner = as(login.body.token);

  const me = await owner.get("/api/auth/me");
  assert.equal(me.body.business.name, "Idealz Lanka");
  assert.equal(me.body.role, "owner");
  assert.equal(me.body.business.features.serials, true, "electronics features are on");
  assert.equal(me.body.business.features.installments, true);
  assert.equal(me.body.business.features.repairs, true);

  const locs = await owner.get("/api/locations");
  assert.deepEqual(
    locs.body.map((l) => `${l.name}:${l.type}`).sort(),
    ["Colombo:store", "Galle:store", "Kandy:store", "Main warehouse:warehouse"].sort()
  );

  const settings = await owner.get("/api/settings");
  assert.equal(settings.body.shopName, "Idealz Lanka");
  assert.equal(settings.body.phone, "077 866 2627");
  assert.equal(settings.body.timezone, "Asia/Colombo");
});

test("a redeploy leaves the live shop alone", async () => {
  await resetDb();
  await autoSetup(ENV);

  // The owner renames a branch and adds a product, as they would in real use.
  const login = await request(app).post("/api/auth/login").send({ email: "owner@idealz.lk", password: PASSWORD });
  const owner = as(login.body.token);
  const locs = await owner.get("/api/locations");
  const colombo = locs.body.find((l) => l.name === "Colombo");
  await owner.put(`/api/locations/${colombo._id}`).send({ name: "Colombo 03" });
  const made = await owner.post("/api/products")
    .set("X-Location-Id", colombo._id)   // the owner picks a branch, as they do in the top bar
    .send({ name: "Nova X5", category: "Phones", price: 199000, quantity: 2 });
  assert.equal(made.status, 201, JSON.stringify(made.body));

  // Starting again (a redeploy) must change nothing.
  const second = await autoSetup({ ...ENV, SHOP_NAME: "Something Else", BRANCHES: "Jaffna" });
  assert.equal(second.created, false);
  assert.equal(second.name, "Idealz Lanka");

  const after = await owner.get("/api/locations");
  assert.equal(after.body.length, 4, "no extra branches were added");
  assert.ok(after.body.some((l) => l.name === "Colombo 03"), "the rename survived");
  const products = await owner.get("/api/products");
  assert.equal(products.body.products.length, 1, "products are untouched");
});

test("the client portal is off for a single shop, on for the platform", async () => {
  assert.equal(platformEnabled({}), true, "no SHOP_NAME: this is the MacQuad platform");
  assert.equal(platformEnabled(ENV), false, "single shop: no portal");
  assert.equal(platformEnabled({ ...ENV, ENABLE_PLATFORM: "1" }), true, "can be turned back on");
});

test("picks SSL correctly for where the database lives", () => {
  const { sslFor } = require("../lib/db");
  // Hosted over the internet: SSL needed.
  assert.ok(sslFor("postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"));
  assert.ok(sslFor("postgresql://u:p@db.example.com:5432/pos"));
  // On the host's own private network or this machine: asking for SSL would fail.
  assert.equal(sslFor("postgresql://u:p@postgres.railway.internal:5432/railway"), false);
  assert.equal(sslFor("postgresql://u:p@localhost:5432/pos"), false);
  assert.equal(sslFor("postgresql://u:p@10.1.2.3:5432/pos"), false);
  // Explicit override either way.
  assert.equal(sslFor("postgresql://u:p@db.example.com/x", "off"), false);
  assert.ok(sslFor("postgresql://u:p@localhost/x", "require"));
});
