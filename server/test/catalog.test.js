const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, setupShop, mkProduct, stockOf } = require("./helpers");

let shop;
before(async () => { shop = await setupShop(); });
after(() => db.close());

test("products: create, validation, unique barcode, blank barcodes don't clash", async () => {
  const { manager } = shop;
  const p = await mkProduct(manager, { name: "Milk", price: "250.50", quantity: 10, barcode: "111", costPrice: 200 });
  assert.equal(p.price, 250.5);
  assert.equal(p.quantity, 10);
  await mkProduct(manager, { name: "Bread", price: 180, barcode: "" });
  await mkProduct(manager, { name: "Buns", price: 50 });
  assert.equal((await manager.post("/api/products").send({ name: "X", category: "C", price: 1, barcode: "111" })).status, 409);
  assert.equal((await manager.post("/api/products").send({ name: "X", category: "C", price: -1 })).status, 400);
  assert.equal((await manager.post("/api/products").send({ category: "C", price: 1 })).status, 400);
  assert.equal((await manager.post("/api/products").send({ name: "X", category: "C", price: 1, quantity: 1.5 })).status, 400);
});

test("products: opening stock is recorded in stock history", async () => {
  const { manager } = shop;
  const p = await mkProduct(manager, { name: "Rice 5kg", price: 1500, quantity: 7 });
  const mv = (await manager.get(`/api/products/${p._id}/movements`)).body;
  assert.equal(mv.length, 1);
  assert.equal(mv[0].reason, "initial");
  assert.equal(mv[0].change, 7);
});

test("products: editing details never touches stock or wipes other fields", async () => {
  const { manager } = shop;
  const p = await mkProduct(manager, { name: "Soap", price: 100, quantity: 5, barcode: "SOAP1", costPrice: 60 });
  const res = await manager.put(`/api/products/${p._id}`).send({ price: 120, quantity: 999 });
  assert.equal(res.status, 200);
  assert.equal(res.body.price, 120);
  assert.equal(res.body.barcode, "SOAP1");
  assert.equal(res.body.costPrice, 60);
  assert.equal(await stockOf(p._id), 5);
});

test("products: cashiers can't see cost price", async () => {
  const list = (await shop.cashier.get("/api/products").query({ filter: "Milk" })).body.products;
  assert.equal(list[0].name, "Milk");
  assert.equal(list[0].costPrice, undefined);
  const m = (await shop.manager.get("/api/products").query({ filter: "Milk" })).body.products;
  assert.equal(m[0].costPrice, 200);
});

test("products: list paging, sorting, search and SQL-injection safety", async () => {
  const { manager } = shop;
  const res = await manager.get("/api/products").query({ limit: 2, sortBy: "price", order: "desc" });
  assert.equal(res.body.products.length, 2);
  assert.ok(res.body.products[0].price >= res.body.products[1].price);
  assert.equal((await manager.get("/api/products").query({ sortBy: "name; drop table users" })).status, 400);
  const inj = await manager.get("/api/products").query({ filter: "%' or 1=1 --" });
  assert.equal(inj.status, 200);
  assert.equal(inj.body.total, 0);
  const pct = await manager.get("/api/products").query({ filter: "%" });
  assert.equal(pct.body.total, 0, "% is treated literally");
});

test("products: barcode lookup, archive hides from till but keeps record", async () => {
  const { manager, cashier } = shop;
  const p = await mkProduct(manager, { name: "Old Item", price: 10, quantity: 1, barcode: "OLD1" });
  assert.equal((await cashier.get("/api/products/barcode/OLD1")).body.name, "Old Item");
  assert.equal((await manager.delete(`/api/products/${p._id}`)).status, 200);
  assert.equal((await cashier.get("/api/products/barcode/OLD1")).status, 404);
  const archived = (await manager.get("/api/products").query({ status: "archived" })).body.products;
  assert.ok(archived.some((x) => x._id === p._id));
  await manager.put(`/api/products/${p._id}`).send({ active: true });
  assert.equal((await cashier.get("/api/products/barcode/OLD1")).status, 200);
});

test("stock: receive from supplier updates cost and history", async () => {
  const { manager } = shop;
  const sup = (await manager.post("/api/suppliers").send({ name: "Sun", company: "Sun Ltd", contactNumber: "011 222 3333", email: "s@sun.lk", address: "Colombo" })).body;
  const p = await mkProduct(manager, { name: "Tea 100g", price: 400, quantity: 2 });
  const res = await manager.post(`/api/products/${p._id}/stock`).send({ type: "receive", quantity: 24, supplierId: sup._id, unitCost: 310 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.quantity, 26);
  assert.equal(res.body.costPrice, 310);
  const mv = (await manager.get(`/api/products/${p._id}/movements`)).body;
  assert.equal(mv[0].reason, "receive");
  assert.equal(mv[0].supplierName, "Sun");
  assert.equal(mv[0].quantityAfter, 26);
});

test("stock: stock-take adjustment needs a note and records the difference", async () => {
  const { manager, cashier } = shop;
  const p = await mkProduct(manager, { name: "Sugar 1kg", price: 300, quantity: 10 });
  assert.equal((await manager.post(`/api/products/${p._id}/stock`).send({ type: "adjust", quantity: 8 })).status, 400);
  const res = await manager.post(`/api/products/${p._id}/stock`).send({ type: "adjust", quantity: 8, note: "2 damaged" });
  assert.equal(res.body.quantity, 8);
  const mv = (await manager.get(`/api/products/${p._id}/movements`)).body;
  assert.equal(mv[0].change, -2);
  assert.equal((await cashier.post(`/api/products/${p._id}/stock`).send({ type: "receive", quantity: 1 })).status, 403);
  assert.equal((await manager.post(`/api/products/${p._id}/stock`).send({ type: "receive", quantity: 0 })).status, 400);
});

test("low-stock report", async () => {
  const { manager } = shop;
  await mkProduct(manager, { name: "Almost Gone", price: 5, quantity: 1, lowStockThreshold: 3 });
  const low = (await manager.get("/api/reports/low-stock")).body;
  assert.ok(low.some((p) => p.name === "Almost Gone"));
  assert.ok(!low.some((p) => p.name === "Milk"));
  const filtered = (await manager.get("/api/products").query({ lowStock: true })).body.products;
  assert.ok(filtered.some((p) => p.name === "Almost Gone"));
});

test("customers: cashier can add/edit, only manager can delete, blank emails don't clash", async () => {
  const { cashier, manager } = shop;
  const a = await cashier.post("/api/customers").send({ name: "Nimal", contactNumber: "077 123 4567", email: "" });
  const b = await cashier.post("/api/customers").send({ name: "Kamala", contactNumber: "0711234567" });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.body.email, null);
  assert.equal((await cashier.post("/api/customers").send({ name: "Bad", contactNumber: "call me" })).status, 400);
  const upd = await cashier.put(`/api/customers/${a.body._id}`).send({ address: "Galle" });
  assert.equal(upd.body.address, "Galle");
  assert.equal(upd.body.contactNumber, "077 123 4567");
  assert.equal((await cashier.delete(`/api/customers/${b.body._id}`)).status, 403);
  assert.equal((await manager.delete(`/api/customers/${b.body._id}`)).status, 200);
  const found = (await cashier.get("/api/customers").query({ filter: "4567" })).body.customers;
  assert.equal(found.length, 1);
});

test("employees: owner only, validation", async () => {
  const { owner } = shop;
  const e = await owner.post("/api/employees").send({ name: "Kamal", position: "Cashier", salary: "45000", contactNumber: "0770000000", email: "k@x.lk" });
  assert.equal(e.status, 201);
  assert.equal(e.body.salary, 45000);
  assert.equal((await owner.post("/api/employees").send({ name: "X", position: "Y", salary: -5, contactNumber: "1", email: "y@x.lk" })).status, 400);
  assert.equal((await owner.get(`/api/employees/${e.body._id}`)).body.name, "Kamal");
  assert.equal((await owner.get("/api/employees/not-a-uuid")).status, 400);
});
