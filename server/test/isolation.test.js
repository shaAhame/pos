// Two client businesses on the same platform must never see or touch each other's data.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { db, setupShop, mkProduct } = require("./helpers");

let A, B, aProduct, aCustomer, aSale, aLoc, aSupplier, aShift;
before(async () => {
  A = await setupShop({ name: "Shop A", type: "electronics" });
  B = await setupShop({ reset: false, name: "Shop B", type: "electronics" });
  aProduct = await mkProduct(A.owner, { name: "A Phone", price: 1000, quantity: 3, barcode: "SAME-123", trackSerials: true, serials: ["IMEI-A1", "IMEI-A2", "IMEI-A3"] });
  aCustomer = (await A.cashier.post("/api/customers").send({ name: "A Customer", contactNumber: "0711111111" })).body;
  aSupplier = (await A.manager.post("/api/suppliers").send({ name: "Sup", company: "A Co", contactNumber: "011", email: "s@a.lk", address: "x" })).body;
  aShift = (await A.cashier.post("/api/shifts/open").send({ openingFloat: 0 })).body;
  aSale = (await A.cashier.post("/api/sales").send({ items: [{ product: aProduct._id, quantity: 1, serials: ["IMEI-A1"] }], customer: aCustomer._id, payments: [{ method: "Cash", amount: 1000 }] })).body.sale;
  aLoc = (await A.owner.get("/api/locations")).body[0];
});
after(() => db.close());

test("lists only ever show your own business", async () => {
  assert.equal((await B.owner.get("/api/products")).body.total, 0);
  assert.equal((await B.owner.get("/api/customers")).body.total, 0);
  assert.equal((await B.owner.get("/api/suppliers")).body.total, 0);
  assert.equal((await B.owner.get("/api/sales")).body.total, 0);
  assert.equal((await B.owner.get("/api/shifts")).body.total, 0);
  assert.equal((await B.owner.get("/api/users")).body.length, 3);
  assert.ok((await B.owner.get("/api/locations")).body.every((l) => l._id !== aLoc._id));
  assert.equal((await B.owner.get("/api/reports/summary")).body.salesCount, 0);
  assert.equal((await B.owner.get("/api/settings")).body.shopName, "Shop B");
});

test("reading another business's records by id finds nothing", async () => {
  for (const p of [`/api/products/${aProduct._id}`, `/api/customers/${aCustomer._id}`, `/api/suppliers/${aSupplier._id}`, `/api/sales/${aSale._id}`, `/api/shifts/${aShift._id}`]) {
    assert.equal((await B.owner.get(p)).status, 404, p);
  }
  assert.deepEqual((await B.owner.get("/api/serials/lookup").query({ q: "IMEI-A1" })).body, []);
  assert.equal((await B.owner.get(`/api/products/${aProduct._id}/serials`)).body.length, 0);
  assert.equal((await B.owner.get("/api/products/barcode/IMEI-A2")).status, 404);
});

test("changing another business's records is refused", async () => {
  assert.equal((await B.owner.put(`/api/products/${aProduct._id}`).send({ price: 1 })).status, 404);
  assert.equal((await B.owner.delete(`/api/products/${aProduct._id}`)).status, 404);
  assert.equal((await B.owner.put(`/api/customers/${aCustomer._id}`).send({ name: "x" })).status, 404);
  assert.equal((await B.owner.delete(`/api/customers/${aCustomer._id}`)).status, 404);
  assert.equal((await B.manager.post(`/api/sales/${aSale._id}/void`).send({ reason: "x" })).status, 404);
  assert.equal((await B.manager.post(`/api/products/${aProduct._id}/stock`).send({ type: "receive", serials: ["X1"] })).status, 404);
  assert.equal((await B.owner.put(`/api/locations/${aLoc._id}`).send({ name: "hack" })).status, 404);
  assert.equal((await B.manager.post(`/api/shifts/${aShift._id}/close`).send({ countedCash: 0 })).status, 404);
  const aUsers = (await A.owner.get("/api/users")).body;
  assert.equal((await B.owner.put(`/api/users/${aUsers[0]._id}`).send({ active: false })).status, 404);
  assert.equal((await A.owner.get(`/api/products/${aProduct._id}`)).body.price, 1000);
});

test("another business's ids can't be used inside your own records", async () => {
  await B.cashier.post("/api/shifts/open").send({ openingFloat: 0 });
  const s = await B.cashier.post("/api/sales").send({ items: [{ product: aProduct._id, quantity: 1, serials: ["IMEI-A2"] }], payments: [{ method: "Cash", amount: 1000 }] });
  assert.equal(s.status, 409);
  const c = await B.cashier.post("/api/sales").send({ items: [{ product: (await mkProduct(B.owner, { name: "B thing", price: 5, quantity: 5 }))._id, quantity: 1 }], customer: aCustomer._id, payments: [{ method: "Cash", amount: 5 }] });
  assert.equal(c.status, 400, "customer of another business");
  const bLoc = (await B.owner.get("/api/locations")).body[0];
  assert.equal((await B.owner.post("/api/transfers").send({ fromLocationId: aLoc._id, toLocationId: bLoc._id, items: [{ product: aProduct._id, quantity: 1, serials: ["IMEI-A2"] }] })).status, 400);
  assert.equal((await B.owner.post("/api/users").send({ firstName: "x", lastName: "y", email: "x@b.lk", password: "Str0ngPass!", role: "cashier", locationId: aLoc._id })).status, 400);
  assert.equal((await B.manager.post("/api/claims").send({ supplierId: aSupplier._id, reason: "x", items: [{ product: aProduct._id, serial: "IMEI-A2" }] })).status, 400);
  assert.equal((await B.manager.post(`/api/products/${(await B.owner.get("/api/products")).body.products[0]._id}/stock`).send({ type: "receive", quantity: 1, supplierId: aSupplier._id })).status, 400);
  assert.equal((await A.owner.get(`/api/products/${aProduct._id}/serials`)).body.length, 2, "A's stock untouched");
});

test("each business has its own numbering, barcodes and serials", async () => {
  const bProduct = await mkProduct(B.owner, { name: "B Phone", price: 900, quantity: 1, barcode: "SAME-123", trackSerials: true, serials: ["IMEI-A1"] });
  assert.equal(bProduct.barcode, "SAME-123");
  const s = await B.cashier.post("/api/sales").send({ clientRef: crypto.randomUUID(), items: [{ product: bProduct._id, quantity: 1, serials: ["IMEI-A1"] }], payments: [{ method: "Card", amount: 900 }] });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.sale.invoiceNumber, "INV-000001", "B numbers its own invoices from 1");
  assert.equal(aSale.invoiceNumber, "INV-000001");
  const lookA = (await A.owner.get("/api/serials/lookup").query({ q: "IMEI-A1" })).body;
  assert.equal(lookA[0].product, "A Phone");
});

test("the database itself refuses cross-business links", async () => {
  const bLoc = (await B.owner.get("/api/locations")).body[0];
  await assert.rejects(
    db.query("update product_stock set location_id = $1 where product_id = $2", [bLoc._id, aProduct._id]),
    /violates foreign key constraint/
  );
});
