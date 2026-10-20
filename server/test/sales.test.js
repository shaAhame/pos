const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { db, setupShop, mkProduct, stockOf } = require("./helpers");

let shop, milk, bread, eggs, cust, cashierShift;
before(async () => {
  shop = await setupShop();
  milk = await mkProduct(shop.manager, { name: "Milk", price: 250.5, quantity: 10, barcode: "111", costPrice: 200 });
  bread = await mkProduct(shop.manager, { name: "Bread", price: 180, quantity: 5, costPrice: 150 });
  eggs = await mkProduct(shop.manager, { name: "Eggs", price: 600, quantity: 3 });
  cust = (await shop.cashier.post("/api/customers").send({ name: "Nimal", contactNumber: "0771234567" })).body;
});
after(() => db.close());

const sell = (user, body) => user.post("/api/sales").send({ paymentMethod: "Cash", ...body });

test("a shift must be open before selling", async () => {
  const res = await sell(shop.cashier, { items: [{ product: milk._id, quantity: 1 }] });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "SHIFT_REQUIRED");
  assert.equal(await stockOf(milk._id), 10);
});

test("open shift; only one open shift per user", async () => {
  const res = await shop.cashier.post("/api/shifts/open").send({ openingFloat: 5000 });
  assert.equal(res.status, 201);
  cashierShift = res.body;
  assert.equal((await shop.cashier.post("/api/shifts/open").send({ openingFloat: 0 })).status, 409);
  assert.equal((await shop.cashier.get("/api/shifts/current")).body._id, cashierShift._id);
  await shop.manager.post("/api/shifts/open").send({ openingFloat: 0 });
});

test("sale: server prices, totals, tender and change, stock deducted", async () => {
  const res = await sell(shop.cashier, {
    clientRef: crypto.randomUUID(),
    items: [{ product: milk._id, quantity: 2, price: 1 }, { product: bread._id, quantity: 1 }, { product: milk._id, quantity: 1 }],
    customer: cust._id, discount: 5, taxRate: 5, amountTendered: 1000,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const s = res.body.sale;
  assert.equal(s.items.length, 2);
  assert.equal(s.subtotal, 931.5);          // 3*250.5 + 180 (client's fake price ignored)
  assert.equal(s.discountAmount, 46.58);
  assert.equal(s.taxAmount, 44.25);
  assert.equal(s.totalAmount, 929.17);
  assert.equal(s.amountTendered, 1000);
  assert.equal(s.changeGiven, 70.83);
  assert.equal(s.customerName, "Nimal");
  assert.equal(s.invoiceNumber, "INV-000001");
  assert.equal(s.cashier.firstName, "Carl");
  assert.equal(s.shiftId, cashierShift._id);
  assert.equal(await stockOf(milk._id), 7);
  assert.equal(await stockOf(bread._id), 4);
});

test("sale: input validation", async () => {
  const bad = [
    { items: [] },
    { items: [{ product: milk._id, quantity: 1.5 }] },
    { items: [{ product: milk._id, quantity: 0 }] },
    { items: [{ product: "nope", quantity: 1 }] },
    { items: [{ product: milk._id, quantity: 1 }], paymentMethod: "Bitcoin" },
    { items: [{ product: milk._id, quantity: 1 }], discount: 150 },
    { items: [{ product: milk._id, quantity: 1 }], customer: crypto.randomUUID() },
    { items: [{ product: milk._id, quantity: 1 }], amountTendered: 10 },
  ];
  for (const b of bad) assert.equal((await sell(shop.cashier, b)).status, 400, JSON.stringify(b));
  assert.equal(await stockOf(milk._id), 7);
});

test("sale: cashier discount limit (managers are exempt)", async () => {
  await shop.owner.put("/api/settings").send({ maxCashierDiscount: 10 });
  const res = await sell(shop.cashier, { items: [{ product: eggs._id, quantity: 1 }], discount: 15 });
  assert.equal(res.status, 403);
  const ok = await sell(shop.manager, { items: [{ product: eggs._id, quantity: 1 }], discount: 15, paymentMethod: "Card" });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.sale.totalAmount, 510);
});

test("sale: oversell refused and nothing changes", async () => {
  const res = await sell(shop.cashier, { items: [{ product: milk._id, quantity: 1 }, { product: eggs._id, quantity: 50 }] });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /Not enough stock for "Eggs"/);
  assert.equal(await stockOf(milk._id), 7);
  assert.equal(await stockOf(eggs._id), 2);
});

test("sale: archived products can't be sold", async () => {
  const p = await mkProduct(shop.manager, { name: "Gone", price: 5, quantity: 5 });
  await shop.manager.delete(`/api/products/${p._id}`);
  assert.equal((await sell(shop.cashier, { items: [{ product: p._id, quantity: 1 }] })).status, 409);
});

test("sale: two tills racing for the last items - exactly one wins", async () => {
  const p = await mkProduct(shop.manager, { name: "Last One", price: 99, quantity: 2 });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => sell(shop.cashier, { items: [{ product: p._id, quantity: 2 }] })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
  assert.equal(await stockOf(p._id), 0);
});

test("sale: retries with the same clientRef record the sale only once", async () => {
  const ref = crypto.randomUUID();
  const before = await stockOf(bread._id);
  const body = { clientRef: ref, items: [{ product: bread._id, quantity: 1 }] };
  const [a, b, c] = await Promise.all([sell(shop.cashier, body), sell(shop.cashier, body), sell(shop.cashier, body)]);
  const statuses = [a.status, b.status, c.status].sort();
  assert.deepEqual(statuses, [200, 200, 201]);
  assert.equal(new Set([a, b, c].map((r) => r.body.sale._id)).size, 1);
  assert.equal(await stockOf(bread._id), before - 1);
});

test("offline sync: records the sale even with a stock shortfall, keeps time and offline price, flags it", async () => {
  const p = await mkProduct(shop.manager, { name: "Offline Item", price: 100, quantity: 2 });
  const when = new Date(Date.now() - 3600e3).toISOString();
  const res = await sell(shop.cashier, {
    clientRef: crypto.randomUUID(), offline: true, createdAt: when, shiftId: cashierShift._id,
    items: [{ product: p._id, quantity: 3, price: 90, name: "Offline Item" }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const s = res.body.sale;
  assert.equal(s.offline, true);
  assert.equal(s.totalAmount, 270);
  assert.equal(new Date(s.date).toISOString(), when);
  assert.match(s.offlineNote, /only 2 in stock/);
  assert.match(s.offlineNote, /sold at 90 offline/);
  assert.equal(await stockOf(p._id), 0);
  const mv = (await shop.manager.get(`/api/products/${p._id}/movements`)).body;
  assert.ok(mv.some((m) => m.reason === "offline_shortfall"));
  const review = (await shop.manager.get("/api/sales").query({ offline: true })).body.sales;
  assert.ok(review.some((x) => x._id === s._id));
});

test("offline sync: unknown product still records the sale; implausible time replaced", async () => {
  const res = await sell(shop.cashier, {
    clientRef: crypto.randomUUID(), offline: true, createdAt: "2001-01-01T00:00:00Z",
    items: [{ product: crypto.randomUUID(), quantity: 1, price: 50, name: "Mystery" }],
  });
  assert.equal(res.status, 201);
  assert.match(res.body.sale.offlineNote, /not found/);
  assert.ok(new Date(res.body.sale.date).getFullYear() >= 2026);
});

test("cashiers only see their own sales; managers see all", async () => {
  const mine = (await shop.cashier.get("/api/sales")).body.sales;
  assert.ok(mine.length > 0);
  assert.ok(mine.every((s) => s.cashier.firstName === "Carl"));
  const all = (await shop.manager.get("/api/sales")).body.sales;
  assert.ok(all.some((s) => s.cashier.firstName === "Mia"));
  const managersSale = all.find((s) => s.cashier.firstName === "Mia");
  assert.equal((await shop.cashier.get(`/api/sales/${managersSale._id}`)).status, 403);
  const search = (await shop.manager.get("/api/sales").query({ q: "INV-000001" })).body;
  assert.equal(search.total, 1);
});

test("void: manager only, restores stock, once only", async () => {
  const before = await stockOf(milk._id);
  const s = (await sell(shop.cashier, { items: [{ product: milk._id, quantity: 2 }] })).body.sale;
  assert.equal(await stockOf(milk._id), before - 2);
  assert.equal((await shop.cashier.post(`/api/sales/${s._id}/void`).send({ reason: "x" })).status, 403);
  assert.equal((await shop.manager.post(`/api/sales/${s._id}/void`).send({})).status, 400);
  const results = await Promise.all([1, 2].map(() => shop.manager.post(`/api/sales/${s._id}/void`).send({ reason: "Rang up twice" })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await stockOf(milk._id), before);
  const v = (await shop.manager.get(`/api/sales/${s._id}`)).body;
  assert.equal(v.paymentStatus, "Voided");
  assert.equal(v.voided.reason, "Rang up twice");
  assert.equal(v.voided.byName, "Mia manager");
  assert.equal((await shop.manager.delete(`/api/sales/${s._id}`)).status, 404);
});

test("void of an offline shortfall sale only returns what was actually taken from stock", async () => {
  const p = await mkProduct(shop.manager, { name: "Short", price: 10, quantity: 1 });
  const s = (await sell(shop.cashier, { clientRef: crypto.randomUUID(), offline: true, items: [{ product: p._id, quantity: 3, price: 10, name: "Short" }] })).body.sale;
  assert.equal(await stockOf(p._id), 0);
  await shop.manager.post(`/api/sales/${s._id}/void`).send({ reason: "test" });
  assert.equal(await stockOf(p._id), 1);
});

test("returns: partial return, refund includes discount and tax share, restock optional", async () => {
  const before = await stockOf(milk._id);
  const s = (await sell(shop.manager, { items: [{ product: milk._id, quantity: 3 }, { product: bread._id, quantity: 1 }], discount: 10, taxRate: 10 })).body.sale;
  const milkLine = s.items.find((i) => i.name === "Milk");
  const breadLine = s.items.find((i) => i.name === "Bread");
  assert.equal((await shop.cashier.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: milkLine._id, quantity: 1 }], reason: "x" })).status, 403);
  assert.equal((await shop.manager.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: milkLine._id, quantity: 4 }], reason: "x" })).status, 400);

  const r1 = await shop.manager.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: milkLine._id, quantity: 1 }], reason: "Sour" });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.refundAmount, 248);   // 250.5 * 0.9 * 1.1 = 247.995 -> 248.00
  assert.equal(r1.body.returnNumber, "RET-000001");
  assert.equal(await stockOf(milk._id), before - 2);
  assert.equal(r1.body.sale.returnStatus, "Partially returned");

  const r2 = await shop.manager.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: breadLine._id, quantity: 1, restock: false }], reason: "Crushed" });
  assert.equal(r2.status, 201);
  // last items back: refund the exact remainder so the total refunded equals what was paid
  const r3 = await shop.manager.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: milkLine._id, quantity: 2 }], reason: "Sour" });
  assert.equal(r3.status, 201);
  const final = r3.body.sale;
  assert.equal(final.returnStatus, "Returned");
  assert.equal(Math.round(final.refundedAmount * 100), Math.round(final.totalAmount * 100));
  assert.equal(await stockOf(milk._id), before);           // all milk back on shelf
  assert.equal((await shop.manager.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: milkLine._id, quantity: 1 }], reason: "x" })).status, 400);
  assert.equal((await shop.manager.post(`/api/sales/${s._id}/void`).send({ reason: "x" })).status, 409);
  assert.equal(final.returns.length, 3);
});

test("returns: cash refund needs the refunder to have an open shift", async () => {
  const s = (await sell(shop.cashier, { items: [{ product: bread._id, quantity: 1 }] })).body.sale;
  const res = await shop.owner.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: s.items[0]._id, quantity: 1 }], reason: "x" });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "SHIFT_REQUIRED");
  const card = await shop.owner.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: s.items[0]._id, quantity: 1 }], reason: "x", refundMethod: "Card" });
  assert.equal(card.status, 201);
});

test("cash-up: expected cash = float + cash sales - cash refunds; variance recorded; voids blocked after close", async () => {
  const cur = (await shop.cashier.get("/api/shifts/current")).body;
  const sum = cur.summary;
  const expected = Math.round((5000 + sum.cashSales - sum.cashRefunds) * 100) / 100;
  assert.equal(sum.expectedCash, expected);
  const lastSale = (await shop.cashier.get("/api/sales").query({ status: "Paid", limit: 1 })).body.sales[0];
  assert.equal((await shop.cashier.post(`/api/shifts/${cur._id}/close`).send({})).status, 400);
  const res = await shop.cashier.post(`/api/shifts/${cur._id}/close`).send({ countedCash: expected - 100, note: "short 100" });
  assert.equal(res.status, 200);
  assert.equal(res.body.variance, -100);
  assert.equal(res.body.status, "closed");
  assert.equal((await shop.cashier.post(`/api/shifts/${cur._id}/close`).send({ countedCash: 1 })).status, 409);
  assert.equal((await shop.cashier.get("/api/shifts/current")).body, null);
  assert.equal((await shop.manager.post(`/api/sales/${lastSale._id}/void`).send({ reason: "late" })).status, 409);
  const list = (await shop.manager.get("/api/shifts").query({ status: "closed" })).body;
  assert.ok(list.shifts.some((s) => s._id === cur._id));
});

test("reports: summary, daily, top products, CSV", async () => {
  const { manager } = shop;
  const sum = (await manager.get("/api/reports/summary")).body;
  assert.ok(sum.salesCount > 0);
  assert.equal(sum.netSales, Math.round((sum.grossSales - sum.refunds) * 100) / 100);
  assert.equal(sum.grossSales, Math.round((sum.cashSales + sum.cardSales) * 100) / 100);
  assert.ok(sum.voidCount >= 2);
  assert.ok(sum.returnCount >= 4);
  assert.equal(sum.profitCoverage, "partial");
  assert.ok(sum.offlineReviewCount >= 2);

  const today = sum.to;
  const daily = (await manager.get("/api/reports/daily").query({ from: "2026-01-01", to: today })).body;
  assert.equal(daily[daily.length - 1].day, today);
  assert.equal(daily[daily.length - 1].grossSales, sum.grossSales);
  assert.equal((await manager.get("/api/reports/daily").query({ from: "2026-02-01", to: "2026-01-01" })).status, 400);

  const top = (await manager.get("/api/reports/top-products").query({ limit: 3 })).body;
  assert.ok(top.length <= 3 && top.length > 0);
  assert.ok(top[0].revenue >= top[top.length - 1].revenue);

  const csv = await manager.get("/api/reports/sales.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  const lines = csv.text.replace(/^﻿/, "").split("\r\n");
  assert.match(lines[0], /^Invoice,Date,Customer/);
  assert.ok(lines.length > 5);
});

test("deleting a customer keeps their sales; health check works", async () => {
  const s = (await shop.manager.get("/api/sales").query({ q: "Nimal" })).body.sales[0];
  assert.equal((await shop.manager.delete(`/api/customers/${cust._id}`)).status, 200);
  const after = (await shop.manager.get(`/api/sales/${s._id}`)).body;
  assert.equal(after.customerName, "Nimal");
  assert.equal(after.customer, null);
  const h = await shop.raw.get("/api/health");
  assert.equal(h.body.ok, true);
});
