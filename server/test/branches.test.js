const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, setupShop, mkProduct, stockOf, as, PASSWORD } = require("./helpers");

let shop, main, galle, wh, galleMgr, galleCashier, rice, soap;
const at = (user, loc) => ({
  get: (p) => user.get(p).set("X-Location-Id", loc),
  post: (p) => user.post(p).set("X-Location-Id", loc),
  put: (p) => user.put(p).set("X-Location-Id", loc),
});

before(async () => {
  shop = await setupShop();
});
after(() => db.close());

test("a new install has one branch, and staff are placed in it automatically", async () => {
  const locs = (await shop.owner.get("/api/locations")).body;
  assert.equal(locs.length, 1);
  main = locs[0];
  assert.equal(main.name, "Main store");
  const users = (await shop.owner.get("/api/users")).body;
  assert.ok(users.filter((u) => u.role !== "owner").every((u) => u.location?._id === main._id));
});

test("owner adds branches; others can't", async () => {
  assert.equal((await shop.manager.post("/api/locations").send({ name: "X" })).status, 403);
  galle = (await shop.owner.post("/api/locations").send({ name: "Galle", address: "Galle Rd", phone: "091 222 3333" })).body;
  wh = (await shop.owner.post("/api/locations").send({ name: "Warehouse", type: "warehouse" })).body;
  assert.equal(galle.type, "store");
  assert.equal(wh.type, "warehouse");
  assert.equal((await shop.owner.post("/api/locations").send({ name: "galle" })).status, 409);
  assert.equal((await shop.cashier.get("/api/locations")).body.length, 3);
});

test("with several branches, new staff must be given a branch", async () => {
  const r = shop.raw;
  assert.equal((await shop.owner.post("/api/users").send({ firstName: "G", lastName: "M", email: "gm@test.lk", password: PASSWORD, role: "manager" })).status, 400);
  const m = await shop.owner.post("/api/users").send({ firstName: "Gita", lastName: "Manager", email: "gm@test.lk", password: PASSWORD, role: "manager", locationId: galle._id });
  assert.equal(m.status, 201);
  assert.equal(m.body.location.name, "Galle");
  await shop.owner.post("/api/users").send({ firstName: "Gopi", lastName: "Cashier", email: "gc@test.lk", password: PASSWORD, role: "cashier", locationId: galle._id });
  galleMgr = as((await r.post("/api/auth/login").send({ email: "gm@test.lk", password: PASSWORD })).body.token);
  galleCashier = as((await r.post("/api/auth/login").send({ email: "gc@test.lk", password: PASSWORD })).body.token);
  assert.equal((await galleMgr.get("/api/auth/me")).body.locationId, galle._id);
});

test("only the owner adds products; opening stock goes to the chosen branch; stock is per branch", async () => {
  assert.equal((await shop.manager.post("/api/products").send({ name: "X", category: "C", price: 1 })).status, 403);
  rice = await mkProduct(shop.owner, { name: "Rice 5kg", price: 2400, costPrice: 2000, quantity: 100, locationId: wh._id, barcode: "RICE" });
  soap = await mkProduct(shop.owner, { name: "Soap", price: 100, quantity: 10, locationId: main._id });
  assert.equal(await stockOf(rice._id, wh._id), 100);
  assert.equal(await stockOf(rice._id, galle._id), 0);
  // owner with no branch chosen sees the total; with a branch chosen, that branch's stock
  assert.equal((await shop.owner.get("/api/products").query({ filter: "Rice" })).body.products[0].quantity, 100);
  assert.equal((await at(shop.owner, galle._id).get("/api/products").query({ filter: "Rice" })).body.products[0].quantity, 0);
  // managers and cashiers always see their own branch
  assert.equal((await galleCashier.get("/api/products").query({ filter: "Rice" })).body.products[0].quantity, 0);
  assert.equal((await galleCashier.get("/api/products").query({ filter: "Rice", locationId: wh._id })).status, 403);
  const byLoc = (await shop.owner.get("/api/products").query({ filter: "Rice", withStock: true })).body.products[0].stockByLocation;
  assert.deepEqual(byLoc.map((x) => [x.name, x.quantity]).sort(), [["Galle", 0], ["Main store", 0], ["Warehouse", 100]]);
  // a product created later exists (with 0) in a branch created later too
  const newer = (await shop.owner.post("/api/locations").send({ name: "Matara" })).body;
  assert.equal((await at(shop.owner, newer._id).get("/api/products").query({ filter: "Soap" })).body.products[0].quantity, 0);
  await shop.owner.put(`/api/locations/${newer._id}`).send({ active: false });
});

test("managers count and receive stock only in their own branch", async () => {
  const ok = await galleMgr.post(`/api/products/${soap._id}/stock`).send({ type: "receive", quantity: 5 });
  assert.equal(ok.status, 200);
  assert.equal(await stockOf(soap._id, galle._id), 5);
  assert.equal(await stockOf(soap._id, main._id), 10);
  assert.equal((await galleMgr.post(`/api/products/${soap._id}/stock`).send({ type: "receive", quantity: 5, locationId: main._id })).status, 403);
  const mv = (await galleMgr.get(`/api/products/${soap._id}/movements`)).body;
  assert.ok(mv.every((m) => m.locationName === "Galle"));
});

test("transfers: only the owner sends; stock leaves the source at once", async () => {
  const body = { fromLocationId: wh._id, toLocationId: galle._id, items: [{ product: rice._id, quantity: 10 }], note: "Weekly top-up" };
  assert.equal((await shop.manager.post("/api/transfers").send(body)).status, 403);
  assert.equal((await galleMgr.post("/api/transfers").send(body)).status, 403);
  assert.equal((await shop.owner.post("/api/transfers").send({ ...body, toLocationId: wh._id })).status, 400);
  const t = await shop.owner.post("/api/transfers").send(body);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.status, "in_transit");
  assert.equal(t.body.transferNumber, "TRF-000001");
  assert.equal(await stockOf(rice._id, wh._id), 90);
  assert.equal(await stockOf(rice._id, galle._id), 0, "nothing arrives until it's received");
});

test("transfers: can't send more than the source has; nothing changes", async () => {
  const res = await shop.owner.post("/api/transfers").send({ fromLocationId: wh._id, toLocationId: main._id, items: [{ product: soap._id, quantity: 1 }, { product: rice._id, quantity: 5 }] });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /Not enough stock for "Soap"/);
  assert.equal(await stockOf(rice._id, wh._id), 90);
  assert.equal((await shop.owner.get("/api/transfers").query({ status: "all" })).body.total, 1);
});

test("transfers: receiving branch confirms; shortage recorded; can't receive twice; other branches can't", async () => {
  const t = (await shop.owner.get("/api/transfers")).body.transfers[0];
  assert.equal((await shop.manager.post(`/api/transfers/${t._id}/receive`).send({})).status, 404, "Main store manager can't see it");
  assert.equal((await shop.manager.get(`/api/transfers/${t._id}`)).status, 404);
  assert.equal((await galleMgr.post(`/api/transfers/${t._id}/receive`).send({ items: [{ itemId: t.items[0]._id, quantityReceived: 11 }] })).status, 400);
  const r = await galleMgr.post(`/api/transfers/${t._id}/receive`).send({ items: [{ itemId: t.items[0]._id, quantityReceived: 9 }], note: "One bag torn" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "received");
  assert.equal(r.body.totalReceived, 9);
  assert.match(r.body.receiveNote, /Rice 5kg: 1 missing/);
  assert.equal(await stockOf(rice._id, galle._id), 9);
  assert.equal(await stockOf(rice._id, wh._id), 90);
  assert.equal((await galleMgr.post(`/api/transfers/${t._id}/receive`).send({})).status, 409);
  const mv = (await shop.owner.get(`/api/products/${rice._id}/movements`)).body;
  assert.ok(mv.some((m) => m.reason === "transfer_short" && m.locationName === "Galle"));
  assert.ok(mv.some((m) => m.reason === "transfer_out" && m.transferNumber === "TRF-000001"));
});

test("transfers: owner cancels in transit and stock goes back; received ones can't be cancelled", async () => {
  const t = (await shop.owner.post("/api/transfers").send({ fromLocationId: wh._id, toLocationId: main._id, items: [{ product: rice._id, quantity: 20 }] })).body;
  assert.equal(await stockOf(rice._id, wh._id), 70);
  assert.equal((await shop.manager.post(`/api/transfers/${t._id}/cancel`).send({ reason: "x" })).status, 403);
  assert.equal((await shop.owner.post(`/api/transfers/${t._id}/cancel`).send({})).status, 400);
  const c = await shop.owner.post(`/api/transfers/${t._id}/cancel`).send({ reason: "Truck broke down" });
  assert.equal(c.body.status, "cancelled");
  assert.equal(await stockOf(rice._id, wh._id), 90);
  assert.equal((await shop.manager.post(`/api/transfers/${t._id}/receive`).send({})).status, 409);
  const first = (await shop.owner.get("/api/transfers").query({ status: "received" })).body.transfers[0];
  assert.equal((await shop.owner.post(`/api/transfers/${first._id}/cancel`).send({ reason: "x" })).status, 409);
});

test("transfers: two transfers racing for the same last stock - exactly one wins", async () => {
  const p = await mkProduct(shop.owner, { name: "Last Box", price: 50, quantity: 5, locationId: wh._id });
  const send = (to) => shop.owner.post("/api/transfers").send({ fromLocationId: wh._id, toLocationId: to, items: [{ product: p._id, quantity: 5 }] });
  const res = await Promise.all([send(galle._id), send(main._id), send(galle._id)]);
  assert.deepEqual(res.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal(await stockOf(p._id, wh._id), 0);
});

test("selling in a branch uses that branch's stock only", async () => {
  // warehouses don't sell
  assert.equal((await at(shop.owner, wh._id).post("/api/shifts/open").send({ openingFloat: 0 })).status, 400);
  // owner with several shops must pick one
  const none = await shop.owner.post("/api/shifts/open").send({ openingFloat: 0 });
  assert.equal(none.status, 400);
  assert.equal(none.body.code, "LOCATION_REQUIRED");

  const sh = await galleCashier.post("/api/shifts/open").send({ openingFloat: 1000 });
  assert.equal(sh.body.location.name, "Galle");
  const s = await galleCashier.post("/api/sales").send({ items: [{ product: rice._id, quantity: 2 }], paymentMethod: "Cash" });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.sale.location.name, "Galle");
  assert.equal(s.body.sale.location.phone, "091 222 3333");
  assert.equal(await stockOf(rice._id, galle._id), 7);
  assert.equal(await stockOf(rice._id, wh._id), 90);
  // Galle has 0 soap... wait, it received 5 earlier: sell 6 -> refused even though Main has 10
  const over = await galleCashier.post("/api/sales").send({ items: [{ product: soap._id, quantity: 6 }], paymentMethod: "Cash" });
  assert.equal(over.status, 409);
  assert.match(over.body.message, /available: 5/);
});

test("branch managers only see and act on their own branch's sales and shifts", async () => {
  await shop.cashier.post("/api/shifts/open").send({ openingFloat: 0 });
  const mainSale = (await shop.cashier.post("/api/sales").send({ items: [{ product: soap._id, quantity: 1 }], paymentMethod: "Cash" })).body.sale;
  assert.equal(mainSale.location.name, "Main store");
  const gList = (await galleMgr.get("/api/sales")).body.sales;
  assert.ok(gList.length >= 1 && gList.every((s) => s.location.name === "Galle"));
  assert.equal((await galleMgr.get(`/api/sales/${mainSale._id}`)).status, 403);
  assert.equal((await galleMgr.post(`/api/sales/${mainSale._id}/void`).send({ reason: "x" })).status, 403);
  assert.equal((await galleMgr.post(`/api/sales/${mainSale._id}/returns`).send({ items: [{ saleItemId: mainSale.items[0]._id, quantity: 1 }], reason: "x", refundMethod: "Card" })).status, 403);
  const shifts = (await galleMgr.get("/api/shifts")).body.shifts;
  assert.ok(shifts.every((s) => s.location.name === "Galle"));
  // void restores stock in the branch it came from
  await shop.manager.post(`/api/sales/${mainSale._id}/void`).send({ reason: "test" });
  assert.equal(await stockOf(soap._id, main._id), 10);
  assert.equal(await stockOf(soap._id, galle._id), 5);
});

test("reports per branch and branch comparison (owner)", async () => {
  const all = (await shop.owner.get("/api/reports/summary")).body;
  const g = (await at(shop.owner, galle._id).get("/api/reports/summary")).body;
  const gm = (await galleMgr.get("/api/reports/summary")).body;
  assert.equal(g.grossSales, 4800);
  assert.equal(gm.grossSales, 4800, "manager report is their branch");
  assert.ok(all.grossSales >= g.grossSales);
  assert.equal((await galleMgr.get("/api/reports/by-location")).status, 403);
  const cmp = (await shop.owner.get("/api/reports/by-location")).body;
  const gRow = cmp.find((x) => x.name === "Galle");
  assert.equal(gRow.grossSales, 4800);
  assert.equal(gRow.stockValueAtCost, 7 * 2000);
  const low = (await galleMgr.get("/api/reports/low-stock")).body;
  assert.ok(low.every((x) => x.locationName === "Galle"));
  const csv = (await shop.owner.get("/api/reports/sales.csv")).text;
  assert.match(csv, /,Galle,/);
});

test("a branch with goods in transit, or open shifts, can't be closed", async () => {
  await shop.owner.post("/api/transfers").send({ fromLocationId: wh._id, toLocationId: main._id, items: [{ product: rice._id, quantity: 1 }] });
  assert.equal((await shop.owner.put(`/api/locations/${wh._id}`).send({ active: false })).status, 409);
  assert.equal((await shop.owner.put(`/api/locations/${galle._id}`).send({ active: false })).status, 409, "Galle has an open shift");
});
