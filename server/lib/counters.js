// Per-business running numbers: INV-000001, RET-000001, ...
const PREFIX = { invoice: "INV", return: "RET", transfer: "TRF", job: "JOB", claim: "CLM", plan: "EP", order: "ORD" };

const nextNumber = async (db, businessId, name) => {
  const { rows } = await db.query(
    `insert into counters (business_id, name, value) values ($1, $2, 1)
     on conflict (business_id, name) do update set value = counters.value + 1
     returning value`,
    [businessId, name]
  );
  return `${PREFIX[name]}-${String(rows[0].value).padStart(6, "0")}`;
};

module.exports = { nextNumber };
