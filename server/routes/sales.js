const express = require("express");
const router = express.Router();
const { query, tx } = require("../db");
const { isId, dbError } = require("../models/util");

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

class SaleError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// Load one or more sales in the shape the React app expects.
const loadSales = async (db, whereSql, params) => {
  const { rows: sales } = await db.query(
    `select s.*,
            c.name as c_name, c.contact_number as c_contact, c.email as c_email, c.address as c_address,
            u.first_name as u_first, u.last_name as u_last
       from sales s
       left join customers c on c.id = s.customer_id
       left join users u on u.id = s.cashier_id
       ${whereSql}
      order by s.date desc, s.invoice_number desc`,
    params
  );
  if (!sales.length) return [];
  const { rows: items } = await db.query(
    "select * from sale_items where sale_id = any($1::uuid[]) order by name",
    [sales.map((s) => s.id)]
  );
  return sales.map((s) => ({
    _id: s.id,
    invoiceNumber: s.invoice_number,
    customer: s.customer_id
      ? { _id: s.customer_id, name: s.c_name, contactNumber: s.c_contact, email: s.c_email, address: s.c_address }
      : null,
    customerName: s.customer_name,
    items: items
      .filter((i) => i.sale_id === s.id)
      .map((i) => ({ _id: i.id, product: i.product_id, name: i.name, quantity: i.quantity, price: i.price, total: i.total })),
    subtotal: s.subtotal,
    discount: s.discount,
    discountAmount: s.discount_amount,
    taxRate: s.tax_rate,
    taxAmount: s.tax_amount,
    totalAmount: s.total_amount,
    paymentStatus: s.payment_status,
    paymentMethod: s.payment_method,
    cashier: s.cashier_id ? { _id: s.cashier_id, firstName: s.u_first, lastName: s.u_last } : null,
    voided: s.voided_at ? { at: s.voided_at, by: s.voided_by, reason: s.void_reason } : undefined,
    date: s.date,
  }));
};

// Create a sale.
// Body: { items: [{ product, quantity }], customer?: id, customerName?, paymentMethod, discount?, taxRate? }
// Prices always come from the database, never from the browser.
router.post("/", async (req, res) => {
  const { items, customer, customerName, paymentMethod, discount = 0, taxRate = 0 } = req.body || {};

  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ message: "Cart is empty" });
  if (!["Cash", "Card"].includes(paymentMethod))
    return res.status(400).json({ message: "Payment method must be Cash or Card" });
  const disc = Number(discount), tax = Number(taxRate);
  if (!(disc >= 0 && disc <= 100) || !(tax >= 0 && tax <= 100))
    return res.status(400).json({ message: "Discount and tax must be between 0 and 100%" });

  const wanted = new Map();
  for (const it of items) {
    const qty = Number(it && it.quantity);
    if (!it || !isId(it.product) || !Number.isInteger(qty) || qty < 1)
      return res.status(400).json({ message: "Each item needs a valid product and a whole-number quantity of at least 1" });
    wanted.set(it.product, (wanted.get(it.product) || 0) + qty);
  }
  if (customer && !isId(customer)) return res.status(400).json({ message: "Invalid customer" });

  try {
    // Everything below is one database transaction: either the whole sale is
    // saved and all stock is deducted, or nothing changes at all.
    const saleId = await tx(async (db) => {
      let custName = (customerName || "").trim() || "Walk-in Customer";
      if (customer) {
        const { rows } = await db.query("select name from customers where id = $1", [customer]);
        if (!rows[0]) throw new SaleError(400, "Customer not found");
        custName = rows[0].name;
      }

      // Lock rows in a fixed order so two tills can't deadlock each other.
      const lines = [];
      for (const productId of [...wanted.keys()].sort()) {
        const qty = wanted.get(productId);
        const { rows } = await db.query(
          "update products set quantity = quantity - $2 where id = $1 and quantity >= $2 returning id, name, price",
          [productId, qty]
        );
        if (!rows[0]) {
          const { rows: ex } = await db.query("select name, quantity from products where id = $1", [productId]);
          throw new SaleError(
            409,
            ex[0]
              ? `Not enough stock for "${ex[0].name}" (available: ${ex[0].quantity}, requested: ${qty})`
              : "A product in the cart no longer exists",
            { productId }
          );
        }
        const p = rows[0];
        lines.push({ productId: p.id, name: p.name, quantity: qty, price: p.price, total: round2(p.price * qty) });
      }

      const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
      const discountAmount = round2((subtotal * disc) / 100);
      const taxAmount = round2(((subtotal - discountAmount) * tax) / 100);
      const totalAmount = round2(subtotal - discountAmount + taxAmount);

      const { rows: saleRows } = await db.query(
        `insert into sales (invoice_number, customer_id, customer_name, subtotal, discount, discount_amount,
                            tax_rate, tax_amount, total_amount, payment_status, payment_method, cashier_id)
         values ('INV-' || lpad(nextval('invoice_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, 'Paid', $9, $10)
         returning id`,
        [customer || null, custName, subtotal, disc, discountAmount, tax, taxAmount, totalAmount, paymentMethod,
         req.user && isId(req.user._id) ? req.user._id : null]
      );
      const id = saleRows[0].id;
      for (const l of lines) {
        await db.query(
          "insert into sale_items (sale_id, product_id, name, quantity, price, total) values ($1, $2, $3, $4, $5, $6)",
          [id, l.productId, l.name, l.quantity, l.price, l.total]
        );
      }
      return id;
    });

    const [sale] = await loadSales({ query }, "where s.id = $1", [saleId]);
    res.status(201).json({ message: "Sale recorded", sale });
  } catch (error) {
    if (error instanceof SaleError) return res.status(error.status).json({ message: error.message, ...error.extra });
    console.error("Error creating sale:", error);
    res.status(500).json({ message: "Could not record the sale. Stock was not changed." });
  }
});

// List sales, newest first.
router.get("/", async (req, res) => {
  try {
    res.status(200).json(await loadSales({ query }, "", []));
  } catch (e) { dbError(res, e, "Error fetching sales"); }
});

// One sale (for the invoice page).
router.get("/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Sale not found" });
  try {
    const [sale] = await loadSales({ query }, "where s.id = $1", [req.params.id]);
    if (!sale) return res.status(404).json({ message: "Sale not found" });
    res.status(200).json(sale);
  } catch (e) { dbError(res, e, "Error fetching sale"); }
});

// Void a sale: keeps the record (for audit), marks it voided and puts the stock back.
router.post("/:id/void", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Sale not found" });
  const reason = String((req.body && req.body.reason) || "").trim();
  if (!reason) return res.status(400).json({ message: "A reason is required to void a sale" });
  try {
    await tx(async (db) => {
      const { rows } = await db.query(
        `update sales set payment_status = 'Voided', voided_at = now(), voided_by = $2, void_reason = $3
          where id = $1 and payment_status <> 'Voided' returning id`,
        [req.params.id, req.user && isId(req.user._id) ? req.user._id : null, reason]
      );
      if (!rows[0]) {
        const { rows: ex } = await db.query("select 1 from sales where id = $1", [req.params.id]);
        throw new SaleError(ex[0] ? 409 : 404, ex[0] ? "Sale is already voided" : "Sale not found");
      }
      // Put stock back (skips products that have since been deleted).
      await db.query(
        `update products p set quantity = p.quantity + x.qty
           from (select product_id, sum(quantity) as qty from sale_items where sale_id = $1 and product_id is not null group by product_id) x
          where p.id = x.product_id`,
        [req.params.id]
      );
    });
    const [sale] = await loadSales({ query }, "where s.id = $1", [req.params.id]);
    res.json({ message: "Sale voided and stock restored", sale });
  } catch (error) {
    if (error instanceof SaleError) return res.status(error.status).json({ message: error.message });
    console.error("Error voiding sale:", error);
    res.status(500).json({ message: "Error voiding sale" });
  }
});

// Sales can no longer be deleted; use void instead so there is always a record.
router.delete("/:id", (req, res) =>
  res.status(405).json({ message: "Sales cannot be deleted. Void the sale instead." })
);

module.exports = router;
