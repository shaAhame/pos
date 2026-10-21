const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, request, app, resetDb, platformAdmin, as, PASSWORD } = require("./helpers");

let admin, grocery, electronics;
before(async () => { await resetDb(); });
after(() => db.close());

test("first platform admin is created once; then only login works", async () => {
  const r = request(app);
  assert.equal((await r.get("/api/auth/status")).body.needsPlatformSetup, true);
  admin = await platformAdmin();
  assert.equal((await r.get("/api/auth/status")).body.needsPlatformSetup, false);
  assert.equal((await r.post("/api/platform/setup").send({ name: "X", email: "x@x.lk", password: PASSWORD })).status, 409);
  assert.equal((await r.post("/api/platform/login").send({ email: "admin@macquad.lk", password: "wrong" })).status, 401);
  assert.equal((await r.get("/api/platform/businesses")).status, 401);
});

test("creating businesses: type presets decide the starting features", async () => {
  const mk = (name, type) => admin.post("/api/platform/businesses").send({
    name, type, contactPhone: "0771234567", owner: { firstName: "O", lastName: name, email: `${type}@client.lk`, password: PASSWORD },
  });
  grocery = (await mk("Fresh Mart", "grocery")).body;
  electronics = (await mk("Phone World", "electronics")).body;
  assert.equal(grocery.features.serials, false);
  assert.equal(grocery.features.splitPayments, true);
  assert.equal(electronics.features.serials, true);
  assert.equal(electronics.features.installments, true);
  assert.equal(electronics.branchCount, 1);
  assert.equal(electronics.userCount, 1);
  const list = (await admin.get("/api/platform/businesses")).body;
  assert.equal(list.length, 2);
  assert.equal((await admin.post("/api/platform/businesses").send({ name: "Dup", owner: { firstName: "a", lastName: "b", email: "grocery@client.lk", password: PASSWORD } })).status, 409);
});

test("feature switches per business take effect at once", async () => {
  const r = request(app);
  const tok = (await r.post("/api/auth/login").send({ email: "grocery@client.lk", password: PASSWORD })).body.token;
  const g = as(tok);
  assert.equal((await g.get("/api/repairs")).status, 403);
  const up = await admin.put(`/api/platform/businesses/${grocery._id}`).send({ features: { repairs: true } });
  assert.equal(up.body.features.repairs, true);
  assert.equal(up.body.features.splitPayments, true, "other switches keep their values");
  assert.equal((await g.get("/api/repairs")).status, 200);
  assert.equal((await g.get("/api/auth/me")).body.business.features.repairs, true);
  await admin.put(`/api/platform/businesses/${grocery._id}`).send({ features: { repairs: false } });
  assert.equal((await g.get("/api/repairs")).status, 403);
});

test("suspending a business locks its staff out immediately; reactivating restores it", async () => {
  const r = request(app);
  const tok = (await r.post("/api/auth/login").send({ email: "electronics@client.lk", password: PASSWORD })).body.token;
  const e = as(tok);
  assert.equal((await e.get("/api/products")).status, 200);
  await admin.put(`/api/platform/businesses/${electronics._id}`).send({ status: "suspended" });
  const blocked = await e.get("/api/products");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "BUSINESS_SUSPENDED");
  assert.equal((await r.post("/api/auth/login").send({ email: "electronics@client.lk", password: PASSWORD })).status, 403);
  await admin.put(`/api/platform/businesses/${electronics._id}`).send({ status: "active" });
  assert.equal((await e.get("/api/products")).status, 200);
});

test("platform and shop logins can't be used for each other", async () => {
  const r = request(app);
  const shopTok = (await r.post("/api/auth/login").send({ email: "grocery@client.lk", password: PASSWORD })).body.token;
  assert.equal((await as(shopTok).get("/api/platform/businesses")).status, 401);
  assert.equal((await admin.get("/api/products")).status, 401);
  assert.equal((await r.post("/api/auth/login").send({ email: "admin@macquad.lk", password: PASSWORD })).status, 401);
});

test("reset a client owner's password", async () => {
  const owner = (await admin.get(`/api/platform/businesses/${grocery._id}`)).body.owners[0];
  assert.equal((await admin.post(`/api/platform/businesses/${grocery._id}/reset-password`).send({ userId: owner._id, password: "short" })).status, 400);
  assert.equal((await admin.post(`/api/platform/businesses/${electronics._id}/reset-password`).send({ userId: owner._id, password: "NewPass2026!" })).status, 404, "owner of another business");
  assert.equal((await admin.post(`/api/platform/businesses/${grocery._id}/reset-password`).send({ userId: owner._id, password: "NewPass2026!" })).status, 200);
  assert.equal((await request(app).post("/api/auth/login").send({ email: "grocery@client.lk", password: "NewPass2026!" })).status, 200);
});

test("more MacQuad admins can be added", async () => {
  const res = await admin.post("/api/platform/admins").send({ name: "Second", email: "two@macquad.lk", password: PASSWORD });
  assert.equal(res.status, 201);
  assert.equal((await request(app).post("/api/platform/login").send({ email: "two@macquad.lk", password: PASSWORD })).status, 200);
});
