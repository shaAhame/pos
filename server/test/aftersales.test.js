const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, setupShop, mkProduct, stockOf, serialStatus } = require("./helpers");

let shop, phone, screen, usedPhone, cust, main;
before(async () => {
  shop = await setupShop({ type: "electronics" });
  main = (await shop.owner.get("/api/locations")).body[0];
  phone = await mkProduct(shop.owner, { name: "iPhone 13", category: "Phones", price: 200000, warrantyMonths: 12, trackSerials: true, quantity: 3, serials: ["IP1", "IP2", "IP3"] });
  screen = await mkProduct(shop.owner, { name: "Screen A15", category: "Parts", price: 15000, costPrice: 9000, quantity: 5 });
  usedPhone = await mkProduct(shop.owner, { name: "Used phone", category: "Second hand", price: 0, trackSerials: true });
  cust = (await shop.cashier.post("/api/customers").send({ name: "Kamal", contactNumber: "0712223333" })).body;
  await shop.cashier.post("/api/shifts/open").send({ openingFloat: 1000 });
});
after(() => db.close());

const cash = () => shop.cashier.get("/api/shifts/current").then((r) => r.body.summary.expectedCash);

test("repair: book in, parts from stock, charge, ready, collect and pay", async () => {
  const j = await shop.cashier.post("/api/repairs").send({ customer: cust._id, customerName: "Kamal", customerPhone: "0712223333", device: "Galaxy A15", serial: "R-EXT-1", issue: "Cracked screen", accessories: "Case", estimate: 20000 });
  assert.equal(j.status, 201, JSON.stringify(j.body));
  assert.equal(j.body.jobNumber, "JOB-000001");
  assert.equal(j.body.underWarranty, false);
  const id = j.body._id;
  assert.equal((await shop.cashier.post(`/api/repairs/${id}/parts`).send({ product: screen._id, quantity: 1 })).status, 201);
  assert.equal(await stockOf(screen._id), 4);
  let d = (await shop.cashier.put(`/api/repairs/${id}`).send({ status: "in_progress", labourCharge: 3500, note: "Replacing screen" })).body;
  assert.equal(d.totalDue, 18500);
  d = (await shop.cashier.put(`/api/repairs/${id}`).send({ status: "ready" })).body;
  assert.ok(d.events.some((e) => e.status === "ready"));
  assert.equal((await shop.cashier.put(`/api/repairs/${id}`).send({ underWarranty: true })).status, 403, "cashier can't waive charges");
  const before = await cash();
  const c = await shop.cashier.post(`/api/repairs/${id}/collect`).send({ payments: [{ method: "Cash", amount: 18500 }], cashTendered: 20000 });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.status, "collected");
  assert.match(c.body.invoiceNumber, /^INV-/);
  assert.equal(await cash(), before + 18500);
  assert.equal(await stockOf(screen._id), 4, "part isn't taken twice");
  assert.equal((await shop.cashier.post(`/api/repairs/${id}/parts`).send({ product: screen._id })).status, 409);
});

test("repair under our warranty is detected from the IMEI and collected free", async () => {
  await shop.cashier.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1, serials: ["IP1"] }], customer: cust._id, payments: [{ method: "Card", amount: 200000 }] });
  const j = (await shop.cashier.post("/api/repairs").send({ customerName: "Kamal", customerPhone: "0712223333", device: "iPhone 13", serial: "ip1", issue: "Battery" })).body;
  assert.equal(j.underWarranty, true);
  await shop.cashier.put(`/api/repairs/${j._id}`).send({ labourCharge: 5000 });
  const c = (await shop.cashier.post(`/api/repairs/${j._id}/collect`).send({})).body;
  assert.equal(c.status, "collected");
  assert.equal(c.invoiceNumber, null);
  const look = (await shop.cashier.get("/api/serials/lookup").query({ q: "IP1" })).body[0];
  assert.equal(look.repairs.length, 1);
});

test("cancelling a repair puts its parts back", async () => {
  const j = (await shop.cashier.post("/api/repairs").send({ customerName: "X", customerPhone: "0700000000", device: "Tab", issue: "No power" })).body;
  await shop.cashier.post(`/api/repairs/${j._id}/parts`).send({ product: screen._id, quantity: 2 });
  assert.equal(await stockOf(screen._id), 2);
  const d = (await shop.cashier.post(`/api/repairs/${j._id}/cancel`).send({ reason: "Customer declined estimate" })).body;
  assert.equal(d.status, "cancelled");
  assert.equal(await stockOf(screen._id), 4);
  assert.equal((await shop.cashier.get("/api/repairs").query({ status: "open" })).body.total, 0);
});

test("installments: down payment now, monthly dues, collections, completion", async () => {
  const noCust = await shop.cashier.post("/api/sales").send({ items: [{ product: phone._id, quantity: 1, serials: ["IP2"] }], payments: [{ method: "Cash", amount: 50000 }], installment: { months: 6 } });
  assert.equal(noCust.status, 400);
  const before = await cash();
  const s = await shop.cashier.post("/api/sales").send({
    items: [{ product: phone._id, quantity: 1, serials: ["IP2"] }], customer: cust._id,
    payments: [{ method: "Cash", amount: 50000 }], installment: { months: 6, fee: 3000 },
  });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const plan = s.body.sale.installmentPlan;
  assert.equal(s.body.sale.paymentMethod, "Installment");
  assert.equal(plan.financed, 153000);
  assert.equal(plan.months, 6);
  assert.equal(await cash(), before + 50000, "only the down payment is cash today");
  const detail = (await shop.cashier.get(`/api/installments/${plan._id}`)).body;
  assert.equal(detail.dues.length, 6);
  assert.equal(Math.round(detail.dues.reduce((t, d) => t + d.amount, 0) * 100), 15300000);
  assert.equal(detail.outstanding, 153000);
  // collect: overpaying is refused; partial payments go to the oldest due first
  assert.equal((await shop.cashier.post(`/api/installments/${plan._id}/pay`).send({ amount: 999999, method: "Cash" })).status, 400);
  const p1 = await shop.cashier.post(`/api/installments/${plan._id}/pay`).send({ amount: 30000, method: "Cash" });
  assert.equal(p1.status, 200);
  const d2 = (await shop.cashier.get(`/api/installments/${plan._id}`)).body;
  assert.equal(d2.dues[0].paid, d2.dues[0].amount);
  assert.equal(d2.dues[1].paid, Math.round((30000 - d2.dues[0].amount) * 100) / 100);
  assert.equal((await shop.cashier.get("/api/shifts/current")).body.summary.cashInstallments, 30000);
  // void is blocked once installments are paid
  assert.equal((await shop.manager.post(`/api/sales/${s.body.sale._id}/void`).send({ reason: "x" })).status, 409);
  const last = await shop.cashier.post(`/api/installments/${plan._id}/pay`).send({ amount: d2.outstanding, method: "Card" });
  assert.equal(last.body.completed, true);
  assert.equal((await shop.cashier.get(`/api/installments/${plan._id}`)).body.status, "completed");
});

test("installments: overdue list, and a return reduces what's still owed", async () => {
  const yesterdayMonthAgo = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
  const s = (await shop.cashier.post("/api/sales").send({
    items: [{ product: phone._id, quantity: 1, serials: ["IP3"] }], customer: cust._id,
    payments: [{ method: "Cash", amount: 20000 }], installment: { months: 3, firstDue: yesterdayMonthAgo },
  })).body.sale;
  const overdue = (await shop.manager.get("/api/installments").query({ status: "overdue" })).body;
  assert.equal(overdue.plans.length, 1);
  assert.ok(overdue.plans[0].overdueAmount > 0);
  await shop.manager.post("/api/shifts/open").send({ openingFloat: 0 });
  const line = s.items[0];
  const r = await shop.manager.post(`/api/sales/${s._id}/returns`).send({ items: [{ saleItemId: line._id, quantity: 1, serials: ["IP3"] }], reason: "Changed mind", refundMethod: "Credit" });
  assert.equal(r.status, 400, "refund is bigger than what's owed; the rest must be paid back another way");
  const plan = (await shop.manager.get(`/api/installments/${s.installmentPlan._id}`)).body;
  assert.equal(plan.outstanding, 180000);

  // a smaller return on an installment sale comes off the balance (latest months first), not out of the drawer
  const s2 = (await shop.cashier.post("/api/sales").send({ items: [{ product: screen._id, quantity: 2 }], customer: cust._id, installment: { months: 2 } })).body.sale;
  assert.equal(s2.installmentPlan.financed, 30000);
  const drawer = (await shop.manager.get("/api/shifts/current")).body.summary.expectedCash;
  const r2 = await shop.manager.post(`/api/sales/${s2._id}/returns`).send({ items: [{ saleItemId: s2.items[0]._id, quantity: 1 }], reason: "One not needed" });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.refundMethod, "Credit");
  const p2 = (await shop.manager.get(`/api/installments/${s2.installmentPlan._id}`)).body;
  assert.equal(p2.outstanding, 15000);
  assert.equal(p2.dues.length, 1, "the last month was removed");
  assert.equal((await shop.manager.get("/api/shifts/current")).body.summary.expectedCash, drawer, "no cash left the drawer");
});

test("advance order: deposit now, complete later; the deposit counts towards the sale", async () => {
  const before = await cash();
  const stockBefore = await stockOf(screen._id);
  const o = await shop.cashier.post("/api/orders").send({ customer: cust._id, customerName: "Kamal", customerPhone: "0712223333", items: [{ product: screen._id, quantity: 2 }], deposit: { amount: 10000, method: "Cash" } });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.total, 30000);
  assert.equal(o.body.balance, 20000);
  assert.equal(await cash(), before + 10000);
  assert.equal((await shop.cashier.post(`/api/orders/${o.body._id}/deposit`).send({ amount: 999999, method: "Cash" })).status, 400);
  await shop.cashier.post(`/api/orders/${o.body._id}/deposit`).send({ amount: 5000, method: "Card" });
  await shop.cashier.post(`/api/orders/${o.body._id}/ready`);
  const c = await shop.cashier.post(`/api/orders/${o.body._id}/complete`).send({ payments: [{ method: "Cash", amount: 15000 }] });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.order.status, "completed");
  assert.deepEqual(c.body.sale.payments.map((p) => [p.method, p.amount]).sort(), [["Cash", 15000], ["Deposit", 15000]]);
  assert.equal(await cash(), before + 25000);
  assert.equal(await stockOf(screen._id), stockBefore - 2, "stock leaves when the customer collects");
});

test("cancelling an order gives the deposit back", async () => {
  const before = await cash();
  const o = (await shop.cashier.post("/api/orders").send({ customerName: "Y", customerPhone: "0700000001", items: [{ product: screen._id, quantity: 1 }], deposit: { amount: 2000, method: "Cash" } })).body;
  const c = await shop.cashier.post(`/api/orders/${o._id}/cancel`).send({ reason: "Found elsewhere" });
  assert.equal(c.body.status, "cancelled");
  assert.equal(await cash(), before);
});

test("trade-in: old phone taken as part payment and put into stock with its IMEI", async () => {
  const before = await cash();
  const s = await shop.cashier.post("/api/sales").send({
    items: [{ product: screen._id, quantity: 1 }],
    payments: [{ method: "Cash", amount: 5000 }],
    tradeIn: { description: "Old Galaxy S10, good condition", serial: "OLD-S10-1", value: 10000, productId: usedPhone._id },
  });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.sale.tradeIn.value, 10000);
  assert.equal(await cash(), before + 5000);
  assert.equal(await serialStatus("OLD-S10-1"), "in_stock");
  assert.equal(await stockOf(usedPhone._id, main._id), 1);
  await shop.manager.post(`/api/sales/${s.body.sale._id}/void`).send({ reason: "Customer kept old phone" });
  assert.equal(await stockOf(usedPhone._id, main._id), 0);
  assert.equal(await serialStatus("OLD-S10-1"), "written_off");
  assert.equal(await cash(), before);
});

test("reports include installments, deposits and trade-ins", async () => {
  const r = (await shop.owner.get("/api/reports/summary")).body;
  assert.ok(r.installmentsCollected >= 30000);
  assert.ok(r.creditSales > 0);
  assert.ok(r.depositsUsed >= 15000);
});
