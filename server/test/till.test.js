const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, setupShop, mkProduct, PASSWORD } = require("./helpers");

let shop, tv, cable, managerId;
before(async () => {
  shop = await setupShop({ type: "grocery" });
  tv = await mkProduct(shop.owner, { name: "TV", price: 50000, quantity: 10 });
  cable = await mkProduct(shop.owner, { name: "Cable", price: 500, quantity: 50 });
  await shop.cashier.post("/api/shifts/open").send({ openingFloat: 2000 });
  await shop.owner.put("/api/settings").send({ maxCashierDiscount: 5 });
  managerId = (await shop.manager.get("/api/auth/me")).body._id;
});
after(() => db.close());

const sell = (b) => shop.cashier.post("/api/sales").send(b);

test("split payment: part cash (with change), part card, part bank transfer", async () => {
  const res = await sell({ items: [{ product: tv._id, quantity: 1 }], payments: [{ method: "Cash", amount: 10000 }, { method: "Card", amount: 30000 }, { method: "Bank", amount: 10000 }], cashTendered: 10500 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const s = res.body.sale;
  assert.equal(s.paymentMethod, "Split");
  assert.equal(s.changeGiven, 500);
  assert.deepEqual(s.payments.map((p) => [p.method, p.amount]).sort(), [["Bank", 10000], ["Card", 30000], ["Cash", 10000]]);
});

test("payments must add up to the total", async () => {
  const res = await sell({ items: [{ product: cable._id, quantity: 2 }], payments: [{ method: "Cash", amount: 900 }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "PAYMENT_MISMATCH");
  assert.equal((await sell({ items: [{ product: cable._id, quantity: 1 }], payments: [{ method: "Cash", amount: 500 }], cashTendered: 100 })).status, 400);
});

test("item discount within the cashier limit is fine; above it needs a manager", async () => {
  const ok = await sell({ items: [{ product: cable._id, quantity: 2, discount: 50 }], payments: [{ method: "Cash", amount: 950 }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.sale.items[0].total, 950);
  const big = { items: [{ product: tv._id, quantity: 1, discount: 5000 }], payments: [{ method: "Card", amount: 45000 }] };
  const denied = await sell(big);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "APPROVAL_REQUIRED");
  // manager sets a PIN, then approves at the cashier's till
  assert.equal((await shop.cashier.post("/api/auth/approval-pin").send({ currentPassword: PASSWORD, pin: "1234" })).status, 403);
  assert.equal((await shop.manager.post("/api/auth/approval-pin").send({ currentPassword: PASSWORD, pin: "12" })).status, 400);
  assert.equal((await shop.manager.post("/api/auth/approval-pin").send({ currentPassword: PASSWORD, pin: "4321" })).status, 200);
  const approvers = (await shop.cashier.get("/api/users/approvers")).body;
  assert.ok(approvers.some((a) => a._id === managerId));
  assert.equal((await sell({ ...big, approval: { userId: managerId, pin: "0000" } })).status, 403);
  const approved = await sell({ ...big, approval: { userId: managerId, pin: "4321" } });
  assert.equal(approved.status, 201);
  assert.equal(approved.body.sale.approvedBy, "Mia manager");
  // sale-level discount counts too
  assert.equal((await sell({ items: [{ product: cable._id, quantity: 1 }], discount: 10, payments: [{ method: "Cash", amount: 450 }] })).status, 403);
});

test("item discounts can be switched off per business", async () => {
  await shop.admin.put(`/api/platform/businesses/${shop.business._id}`).send({ features: { lineDiscounts: false, splitPayments: false } });
  assert.equal((await sell({ items: [{ product: cable._id, quantity: 1, discount: 10 }], payments: [{ method: "Cash", amount: 490 }] })).status, 400);
  assert.equal((await sell({ items: [{ product: cable._id, quantity: 2 }], payments: [{ method: "Cash", amount: 500 }, { method: "Card", amount: 500 }] })).status, 400);
  await shop.admin.put(`/api/platform/businesses/${shop.business._id}`).send({ features: { lineDiscounts: true, splitPayments: true } });
});

test("older tills that send one payment method still work", async () => {
  const res = await sell({ items: [{ product: cable._id, quantity: 1 }], paymentMethod: "Cash", amountTendered: 1000 });
  assert.equal(res.status, 201);
  assert.equal(res.body.sale.changeGiven, 500);
  assert.equal(res.body.sale.paymentMethod, "Cash");
});

test("cash-up counts only the cash parts; voids and refunds take it back out", async () => {
  const before = (await shop.cashier.get("/api/shifts/current")).body.summary;
  // cash so far: 10000 (split) + 950 + 500 = 11450
  assert.equal(before.cashSales, 11450);
  assert.equal(before.expectedCash, 13450);
  assert.equal(before.cardSales, 75000);
  assert.equal(before.bankSales, 10000);
  const s = (await sell({ items: [{ product: cable._id, quantity: 4 }], payments: [{ method: "Cash", amount: 1000 }, { method: "Card", amount: 1000 }] })).body.sale;
  assert.equal((await shop.cashier.get("/api/shifts/current")).body.summary.expectedCash, 14450);
  await shop.manager.post(`/api/sales/${s._id}/void`).send({ reason: "test" });
  const afterVoid = (await shop.cashier.get("/api/shifts/current")).body.summary;
  assert.equal(afterVoid.expectedCash, 13450, "void reverses the cash part");
  assert.equal(afterVoid.cardSales, 75000, "and the card part");
  // cash refund from the cashier... refunds need a manager with an open shift
  await shop.manager.post("/api/shifts/open").send({ openingFloat: 0 });
  const r = (await sell({ items: [{ product: cable._id, quantity: 2 }], payments: [{ method: "Cash", amount: 1000 }] })).body.sale;
  const ret = await shop.manager.post(`/api/sales/${r._id}/returns`).send({ items: [{ saleItemId: r.items[0]._id, quantity: 1 }], reason: "x", refundMethod: "Cash" });
  assert.equal(ret.status, 201);
  const mgr = (await shop.manager.get("/api/shifts/current")).body.summary;
  assert.equal(mgr.cashRefunds, 500);
  assert.equal(mgr.expectedCash, -500, "refund came out of the manager's drawer");
  const rep = (await shop.owner.get("/api/reports/summary")).body;
  assert.ok(rep.bankSales >= 10000);
});
