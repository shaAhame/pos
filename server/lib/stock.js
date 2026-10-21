// Every stock change goes through here so it is always recorded in stock_movements.
const { fail } = require("./errors");

const ensureRow = (db, productId, locationId) =>
  db.query(
    "insert into product_stock (product_id, location_id, quantity) values ($1, $2, 0) on conflict do nothing",
    [productId, locationId]
  );

// Add (positive) or remove (negative) stock at one location. Fails if it would go below zero.
const moveStock = async (db, { productId, locationId, change, reason, saleId = null, returnId = null, transferId = null,
  supplierId = null, unitCost = null, note = null, userId = null }) => {
  await ensureRow(db, productId, locationId);
  const { rows } = await db.query(
    `update product_stock set quantity = quantity + $3
      where product_id = $1 and location_id = $2 and quantity + $3 >= 0
      returning quantity`,
    [productId, locationId, change]
  );
  if (!rows[0]) return null; // not enough stock
  await db.query(
    `insert into stock_movements (product_id, location_id, change, quantity_after, reason, sale_id, return_id, transfer_id, supplier_id, unit_cost, note, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [productId, locationId, change, rows[0].quantity, reason, saleId, returnId, transferId, supplierId, unitCost, note, userId]
  );
  return rows[0].quantity;
};

// Same, but throws a clear 409 when there isn't enough.
const takeStock = async (db, opts, name) => {
  const after = await moveStock(db, { ...opts, change: -Math.abs(opts.quantity) });
  if (after === null) {
    const { rows } = await db.query("select quantity from product_stock where product_id = $1 and location_id = $2", [opts.productId, opts.locationId]);
    fail(409, `Not enough stock for "${name}" (available: ${rows[0]?.quantity ?? 0}, requested: ${opts.quantity})`, { productId: opts.productId, available: rows[0]?.quantity ?? 0 });
  }
  return after;
};

// Record a movement that doesn't change the count (e.g. offline shortfall, transfer shortage).
const noteMovement = async (db, { productId, locationId, reason, note, saleId = null, transferId = null, userId = null }) => {
  await ensureRow(db, productId, locationId);
  const { rows } = await db.query("select quantity from product_stock where product_id = $1 and location_id = $2", [productId, locationId]);
  await db.query(
    `insert into stock_movements (product_id, location_id, change, quantity_after, reason, sale_id, transfer_id, note, user_id)
     values ($1,$2,0,$3,$4,$5,$6,$7,$8)`,
    [productId, locationId, rows[0].quantity, reason, saleId, transferId, note, userId]
  );
};

module.exports = { ensureRow, moveStock, takeStock, noteMovement };
