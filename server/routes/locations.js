// Branches: shops and warehouses. Everyone can list them (for the branch picker); only the owner edits.
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi } = require("../lib/util");
const { Joi, validate, id, text } = require("../lib/validate");
const { requireRole } = require("../middleware/auth");
const { fail } = require("../lib/errors");

router.get("/", async (req, res) => {
  const { rows } = await query(
    `select l.*,
            (select count(*)::int from users u where u.location_id = l.id and u.active) as staff_count,
            (select coalesce(sum(quantity),0)::int from product_stock ps where ps.location_id = l.id) as units_in_stock
       from locations l where l.business_id = $1 order by l.active desc, l.type desc, l.created_at`,
    [req.biz]
  );
  res.json(rows.map((r) => toApi(r, ["business_id"])));
});

const fields = {
  name: text(80), type: Joi.string().valid("store", "warehouse"),
  address: text(300).allow(""), phone: text(60).allow(""), active: Joi.boolean(),
};

router.post(
  "/",
  requireRole("owner"),
  validate(Joi.object({ ...fields, name: fields.name.min(1).required(), type: fields.type.default("store") })),
  async (req, res) => {
    const b = req.body;
    const loc = await tx(async (db) => {
      const { rows } = await db.query(
        "insert into locations (business_id, name, type, address, phone) values ($1,$2,$3,$4,$5) returning *",
        [req.biz, b.name, b.type, b.address || "", b.phone || ""]
      );
      // Every product gets a 0-stock row in the new branch.
      await db.query(
        "insert into product_stock (business_id, product_id, location_id, quantity) select $2, id, $1, 0 from products where business_id = $2 on conflict do nothing",
        [rows[0].id, req.biz]
      );
      return rows[0];
    });
    res.status(201).json(toApi(loc, ["business_id"]));
  }
);

router.put(
  "/:id",
  requireRole("owner"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object(fields).min(1)),
  async (req, res) => {
    const b = req.body;
    const loc = await tx(async (db) => {
      const { rows: [cur] } = await db.query("select * from locations where id = $1 and business_id = $2 for update", [req.params.id, req.biz]);
      if (!cur) fail(404, "Branch not found");
      if (b.active === false && cur.active) {
        const { rows: [c] } = await db.query(
          `select (select count(*)::int from shifts where location_id = $1 and closed_at is null) as open_shifts,
                  (select count(*)::int from transfers where status = 'in_transit' and (from_location_id = $1 or to_location_id = $1)) as transfers,
                  (select count(*)::int from locations where active and id <> $1 and business_id = $2) as others`,
          [cur.id, req.biz]
        );
        if (!c.others) fail(400, "You need at least one active branch");
        if (c.open_shifts) fail(409, "Close the open shifts in this branch first");
        if (c.transfers) fail(409, "This branch has transfers on the way. Receive or cancel them first.");
      }
      if (b.type === "warehouse" && cur.type === "store") {
        const { rows: [c] } = await db.query("select count(*)::int n from shifts where location_id = $1 and closed_at is null", [cur.id]);
        if (c.n) fail(409, "Close the open shifts in this branch before making it a warehouse");
      }
      const keys = Object.keys(b);
      const { rows } = await db.query(
        `update locations set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1 returning *`,
        [cur.id, ...keys.map((k) => b[k])]
      );
      return rows[0];
    });
    res.json(toApi(loc, ["business_id"]));
  }
);

module.exports = router;
