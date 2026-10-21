// Every stock change goes through here so it is always recorded in stock_movements.
const { fail } = require("./errors");

const ensureRow = (db, biz, productId, locationId) =>
  db.query(
    "insert into product_stock (business_id, product_id, location_id, quantity) values ($1, $2, $3, 0) on conflict do nothing",
    [biz, productId, locationId]
  );

// Add (positive) or remove (negative) stock at one location. Returns null if it would go below zero.
const moveStock = async (db, { biz, productId, locationId, change, reason, saleId = null, returnId = null, transferId = null,
  supplierId = null, unitCost = null, note = null, userId = null, refId = null }) => {
  await ensureRow(db, biz, productId, locationId);
  const { rows } = await db.query(
    `update product_stock set quantity = quantity + $4
      where business_id = $1 and product_id = $2 and location_id = $3 and quantity + $4 >= 0
      returning quantity`,
    [biz, productId, locationId, change]
  );
  if (!rows[0]) return null;
  await db.query(
    `insert into stock_movements (business_id, product_id, location_id, change, quantity_after, reason, sale_id, return_id, transfer_id,
                                  supplier_id, unit_cost, note, user_id, ref_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [biz, productId, locationId, change, rows[0].quantity, reason, saleId, returnId, transferId, supplierId, unitCost, note, userId, refId]
  );
  return rows[0].quantity;
};

const takeStock = async (db, opts, name) => {
  const after = await moveStock(db, { ...opts, change: -Math.abs(opts.quantity) });
  if (after === null) {
    const { rows } = await db.query("select quantity from product_stock where business_id = $1 and product_id = $2 and location_id = $3", [opts.biz, opts.productId, opts.locationId]);
    fail(409, `Not enough stock for "${name}" (available: ${rows[0]?.quantity ?? 0}, requested: ${opts.quantity})`, { productId: opts.productId, available: rows[0]?.quantity ?? 0 });
  }
  return after;
};

const noteMovement = async (db, { biz, productId, locationId, reason, note, saleId = null, transferId = null, userId = null, refId = null }) => {
  await ensureRow(db, biz, productId, locationId);
  const { rows } = await db.query("select quantity from product_stock where business_id = $1 and product_id = $2 and location_id = $3", [biz, productId, locationId]);
  await db.query(
    `insert into stock_movements (business_id, product_id, location_id, change, quantity_after, reason, sale_id, transfer_id, note, user_id, ref_id)
     values ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10)`,
    [biz, productId, locationId, rows[0].quantity, reason, saleId, transferId, note, userId, refId]
  );
};

module.exports = { ensureRow, moveStock, takeStock, noteMovement };
