const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, setupShop, mkProduct, stockOf, serialStatus } = require("./helpers");

let shop, phone, charger, main, galle, gm, gc, sup;
before(async () => {
  shop = await setupShop({ type: "electronics", name: "Phone World" });
  main = (await shop.owner.get("/api/locations")).body[0];
  galle = (await shop.owner.post("/api/locations").send({ name: "Galle" })).body;
  await shop.owner.post("/api/users").send({ firstName: "Gm", lastName: "x", email: "gm@pw.lk", password: "Str0ngPass!", role: "manager", locationId: galle._id });
  await shop.owner.post("/api/users").send({ firstName: "Gc", lastName: "x", email: "gc@pw.lk", password: "Str0ngPass!", role: "cashier", locationId: galle._id });
  const { as } = require("./helpers");
  gm = as((await shop.raw.post("/api/auth/login").send({ email: "gm@pw.lk", password: "Str0ngPass!" })).body.token);
  gc = as((await shop.raw.post("/api/auth/login").send({ email: "gc@pw.lk", password: "Str0ngPass!" })).body.token);
  sup = (await shop.manager.post("/api/suppliers").send({ name: "Dist", company: "Lanka Distributors", contactNumber: "011 222", email: "d@ld.lk", address: "Colombo" })).body;
});
after(() => db.close());

test("serial-tracked product: opening stock needs one serial per unit; variants and warranty", async () => {
  assert.equal((await shop.owner.post("/api/products").send({ name: "Galaxy A15", category: "Phones", price: 60000, trackSerials: true, quantity: 2, serials: ["A"], locationId: main._id })).status, 400);
  phone = await mkProduct(shop.owner, {
    name: "Galaxy A15", model: "Galaxy A15", variant: "128GB Black", category: "Phones", price: 60000, costPrice: 52000,
    warrantyMonths: 12, trackSerials: true, quantity: 3, serials: ["356001", "356002", "356003"], locationId: main._id,
  });
  assert.equal(phone.displayName, "Galaxy A15 128GB Black");
  assert.equal(phone.quantity, 3);
  charger = await mkProduct(shop.owner, { name: "Charger 25W", category: "Accessories", price: 3500, quantity: 20, locationId: main._id, warrantyMonths: 6 });
  assert.equal((await shop.owner.post("/api/products").send({ name: "Dup", category: "x", price: 1, trackSerials: true, quantity: 1, serials: ["356001"], locationId: main._id })).status, 409);
});

test("receiving units records their serials; duplicates refused", async () => {
  assert.equal((await shop.manager.post(`/api/products/${phone._id}/stock`).send({ type: "receive", quantity: 2 })).status, 400);
  const r = await shop.manager.post(`/api/products/${phone._id}/stock`).send({ type: "receive", serials: ["356004", "356005"], supplierId: sup._id, unitCost: 51000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.quantity, 5);
  assert.equal((await shop.manager.post(`/api/products/${phone._id}/stock`).send({ type: "receive", serials: ["356005"] })).status, 409);
  assert.equal((await shop.manager.get(`/api/products/${phone._id}/serials`)).body.length, 5);
});

test("scanning an IMEI at the till finds the product", async () => {
  const r = await shop.cashier.get("/api/products/barcode/356004");
  assert.equal(r.status, 200);
  assert.equal(r.body._id, phone._id);
  assert.equal(r.body.scannedSerial.serial, "356004");
});

test("selling a serial-tracked phone requires its IMEI; warranty dates are set", async () => {
  await shop.cashier.post("/api/shifts/open").send({ openingFloat: 0 });
  const no = await shop.cashier.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1 }], payments: [{ method: "Card", amount: 60000 }] });
  assert.equal(no.status, 400);
  assert.equal(no.body.code, "SERIALS_REQUIRED");
  assert.equal((await shop.cashier.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1, serials: ["999999"] }], payments: [{ method: "Card", amount: 60000 }] })).body.code, "SERIAL_UNKNOWN");
  const cust = (await shop.cashier.post("/api/customers").send({ name: "Nimal", contactNumber: "077 123 4567" })).body;
  const s = await shop.cashier.post("/api/sales").send({
    items: [{ product: phone._id, quantity: 2, serials: ["356001", "356002"] }, { product: charger._id, quantity: 1 }],
    customer: cust._id, payments: [{ method: "Card", amount: 123500 }],
  });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const line = s.body.sale.items.find((i) => i.name.startsWith("Galaxy"));
  assert.equal(line.name, "Galaxy A15 128GB Black");
  assert.deepEqual(line.serials.map((x) => x.serial), ["356001", "356002"]);
  assert.match(line.warrantyUntil, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(line.warrantyUntil > new Date().toISOString().slice(0, 10));
  assert.ok(s.body.sale.items.find((i) => i.name === "Charger 25W").warrantyUntil);
  assert.equal(await serialStatus("356001"), "sold");
  assert.equal(await stockOf(phone._id, main._id), 3);
  // the same unit can't be sold twice
  const again = await shop.cashier.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1, serials: ["356001"] }], payments: [{ method: "Card", amount: 60000 }] });
  assert.equal(again.body.code, "SERIAL_UNAVAILABLE");
  // sales can be found by IMEI
  assert.equal((await shop.manager.get("/api/sales").query({ q: "356002" })).body.total, 1);
});

test("warranty lookup by IMEI, invoice number or phone", async () => {
  const u = (await shop.cashier.get("/api/serials/lookup").query({ q: "356001" })).body;
  assert.equal(u.length, 1);
  assert.equal(u[0].status, "sold");
  assert.equal(u[0].underWarranty, true);
  assert.equal(u[0].customerName, "Nimal");
  assert.ok(u[0].events.some((e) => e.event === "sold"));
  const byPhone = (await shop.cashier.get("/api/serials/lookup").query({ q: "0771234567" })).body;
  assert.ok(byPhone.length >= 2);
  assert.ok(byPhone.some((x) => x.serials?.includes("356001")));
});

test("void puts units back on the shelf; return can mark a unit faulty", async () => {
  const s = (await shop.cashier.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1, serials: ["356003"] }], payments: [{ method: "Cash", amount: 60000 }] })).body.sale;
  await shop.manager.post(`/api/sales/${s._id}/void`).send({ reason: "wrong phone" });
  assert.equal(await serialStatus("356003"), "in_stock");
  const sold = (await shop.manager.get("/api/sales").query({ q: "356002" })).body.sales[0];
  const line = sold.items.find((i) => i.serials.length);
  await shop.manager.post("/api/shifts/open").send({ openingFloat: 0 });
  assert.equal((await shop.manager.post(`/api/sales/${sold._id}/returns`).send({ items: [{ saleItemId: line._id, quantity: 1 }], reason: "x", refundMethod: "Card" })).body.code, "SERIALS_REQUIRED");
  const r = await shop.manager.post(`/api/sales/${sold._id}/returns`).send({ items: [{ saleItemId: line._id, quantity: 1, serials: ["356002"], restock: false }], reason: "Screen dead", refundMethod: "Card" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await serialStatus("356002"), "defective");
  assert.equal(await stockOf(phone._id, main._id), 3, "faulty unit not back in sellable stock");
});

test("supplier claim: faulty unit sent back, replacement received with a new IMEI", async () => {
  const c = await shop.manager.post("/api/claims").send({ supplierId: sup._id, reason: "Dead screen under warranty", items: [{ product: phone._id, serial: "356002", fromStock: false }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(await serialStatus("356002"), "with_supplier");
  assert.equal((await shop.cashier.get("/api/claims")).status, 403);
  const item = c.body.items[0];
  assert.equal((await shop.manager.post(`/api/claims/${c.body._id}/resolve`).send({ outcome: "replaced" })).status, 400);
  const r = await shop.manager.post(`/api/claims/${c.body._id}/resolve`).send({ outcome: "replaced", replacementSerials: { [item._id]: "356099" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "replaced");
  assert.equal(await serialStatus("356002"), "written_off");
  assert.equal(await serialStatus("356099"), "in_stock");
  assert.equal(await stockOf(phone._id, main._id), 4);
  // a unit taken off the shelf and sent back, rejected -> stays out of stock as faulty
  const c2 = (await shop.manager.post("/api/claims").send({ supplierId: sup._id, reason: "Fault", items: [{ product: phone._id, serial: "356099" }] })).body;
  assert.equal(await stockOf(phone._id, main._id), 3);
  await shop.manager.post(`/api/claims/${c2._id}/resolve`).send({ outcome: "rejected", note: "physical damage" });
  assert.equal(await serialStatus("356099"), "defective");
  assert.equal(await stockOf(phone._id, main._id), 3);
});

test("transfers move specific units; missing units are recorded", async () => {
  const body = { fromLocationId: main._id, toLocationId: galle._id, items: [{ product: phone._id, quantity: 2, serials: ["356003", "356004"] }] };
  assert.equal((await shop.owner.post("/api/transfers").send({ ...body, items: [{ product: phone._id, quantity: 2, serials: ["356003"] }] })).body.code, "SERIALS_REQUIRED");
  const t = await shop.owner.post("/api/transfers").send(body);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(await serialStatus("356003"), "in_transit");
  const item = t.body.items[0];
  assert.equal(item.serials.length, 2);
  const r = await gm.post(`/api/transfers/${t.body._id}/receive`).send({ items: [{ itemId: item._id, missingSerials: ["356004"] }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await serialStatus("356003"), "in_stock");
  assert.equal(await serialStatus("356004"), "missing");
  assert.equal(await stockOf(phone._id, galle._id), 1);
  // the Galle cashier can now sell that unit there, but not one that's still in Main
  await gc.post("/api/shifts/open").send({ openingFloat: 0 });
  assert.equal((await gc.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1, serials: ["356005"] }], payments: [{ method: "Card", amount: 60000 }] })).body.code, "SERIAL_UNAVAILABLE");
  assert.equal((await gc.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1, serials: ["356003"] }], payments: [{ method: "Card", amount: 60000 }] })).status, 201);
});

test("stock count for serial products: list what's missing or found", async () => {
  const r = await shop.manager.post(`/api/products/${phone._id}/stock`).send({ type: "adjust", removeSerials: ["356005"], addSerials: ["356100"], note: "Monthly count" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await serialStatus("356005"), "missing");
  assert.equal(await serialStatus("356100"), "in_stock");
});

test("turning on serial tracking needs zero stock first", async () => {
  const r = await shop.owner.put(`/api/products/${charger._id}`).send({ trackSerials: true });
  assert.equal(r.status, 400);
});

test("a grocery business can't use electronics features", async () => {
  const g = await setupShop({ reset: false, type: "grocery", name: "Groceries" });
  assert.equal((await g.owner.post("/api/products").send({ name: "x", category: "y", price: 1, trackSerials: true })).status, 400);
  for (const p of ["/api/repairs", "/api/installments", "/api/serials/lookup?q=abc"]) assert.equal((await g.owner.get(p)).status, 403, p);
  assert.equal((await g.manager.get("/api/claims")).status, 403);
});
