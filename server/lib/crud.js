// Standard list/get/create/update/delete routes for a simple per-business table.
const express = require("express");
const { query } = require("./db");
const { snake, toApi } = require("./util");
const { Joi, validate, id } = require("./validate");
const { requireRole } = require("../middleware/auth");
const { fail } = require("./errors");

const likeParam = (s) => "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

module.exports = function crudRouter({
  table, listKey, notFound, createSchema, updateSchema, searchFields, sortable,
  roles = {}, // { read, write, remove } minimum roles
}) {
  const router = express.Router();
  const sortList = ["name", "createdAt", ...sortable];
  const guard = (r) => (r ? [requireRole(r)] : []);
  const shape = (r) => toApi(r, ["business_id"]);
  const blanksToNull = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v === "" ? null : v]));

  router.get(
    "/",
    ...guard(roles.read),
    validate(Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(5000).default(20),
      sortBy: Joi.string().valid(...sortList).default("name"),
      order: Joi.string().valid("asc", "desc").default("asc"),
      filter: Joi.string().trim().allow("").max(100).default(""),
    }), "query"),
    async (req, res) => {
      const { page, limit, sortBy, order, filter } = req.validQuery;
      const params = [req.biz];
      let where = "where business_id = $1";
      if (filter) { params.push(likeParam(filter)); where += ` and (${searchFields.map((f) => `${snake(f)} ilike $2`).join(" or ")})`; }
      const total = (await query(`select count(*)::int as n from ${table} ${where}`, params)).rows[0].n;
      const { rows } = await query(
        `select * from ${table} ${where} order by ${snake(sortBy)} ${order}, id limit ${limit} offset ${(page - 1) * limit}`,
        params
      );
      res.json({ total, totalPages: Math.ceil(total / limit), currentPage: page, [listKey]: rows.map(shape) });
    }
  );

  router.get("/:id", ...guard(roles.read), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
    const { rows } = await query(`select * from ${table} where id = $1 and business_id = $2`, [req.params.id, req.biz]);
    if (!rows[0]) fail(404, notFound);
    res.json(shape(rows[0]));
  });

  router.post("/", ...guard(roles.write), validate(createSchema), async (req, res) => {
    const b = blanksToNull(req.body);
    const keys = Object.keys(b);
    const { rows } = await query(
      `insert into ${table} (business_id, ${keys.map(snake).join(",")}) values ($1, ${keys.map((_, i) => "$" + (i + 2)).join(",")}) returning *`,
      [req.biz, ...keys.map((k) => b[k])]
    );
    res.status(201).json(shape(rows[0]));
  });

  router.put("/:id", ...guard(roles.write), validate(Joi.object({ id: id.required() }), "params"), validate(updateSchema.min(1)), async (req, res) => {
    const b = blanksToNull(req.body);
    const keys = Object.keys(b);
    const { rows } = await query(
      `update ${table} set ${keys.map((k, i) => `${snake(k)} = $${i + 3}`).join(",")} where id = $1 and business_id = $2 returning *`,
      [req.params.id, req.biz, ...keys.map((k) => b[k])]
    );
    if (!rows[0]) fail(404, notFound);
    res.json(shape(rows[0]));
  });

  router.delete("/:id", ...guard(roles.remove || roles.write), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
    const { rowCount } = await query(`delete from ${table} where id = $1 and business_id = $2`, [req.params.id, req.biz]);
    if (!rowCount) fail(404, notFound);
    res.json({ message: "Deleted" });
  });

  return router;
};

module.exports.likeParam = likeParam;
