// Standard list/get/create/update/delete routes for a simple table.
const express = require("express");
const { query } = require("./db");
const { snake, toApi } = require("./util");
const { Joi, validate, id } = require("./validate");
const { requireRole } = require("../middleware/auth");
const { fail } = require("./errors");

const listQuery = (sortable) => Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(5000).default(20),
  sortBy: Joi.string().valid(...sortable).default("name"),
  order: Joi.string().valid("asc", "desc").default("asc"),
  filter: Joi.string().trim().allow("").max(100).default(""),
});

const likeParam = (s) => "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

module.exports = function crudRouter({
  table, listKey, notFound, createSchema, updateSchema, searchFields, sortable,
  roles = {}, // { read, write, remove } minimum roles
  extend,
}) {
  const router = express.Router();
  const sortList = ["name", "createdAt", ...sortable];
  const guard = (r) => (r ? [requireRole(r)] : []);

  // Store blank optional fields as NULL (so e.g. two customers without an email don't clash).
  const blanksToNull = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v === "" ? null : v]));

  if (extend) extend(router);

  router.get("/", ...guard(roles.read), validate(listQuery(sortList), "query"), async (req, res) => {
    const { page, limit, sortBy, order, filter } = req.validQuery;
    const where = filter ? `where ${searchFields.map((f) => `${snake(f)} ilike $1`).join(" or ")}` : "";
    const params = filter ? [likeParam(filter)] : [];
    const total = (await query(`select count(*)::int as n from ${table} ${where}`, params)).rows[0].n;
    const { rows } = await query(
      `select * from ${table} ${where} order by ${snake(sortBy)} ${order}, id limit ${limit} offset ${(page - 1) * limit}`,
      params
    );
    res.json({ total, totalPages: Math.ceil(total / limit), currentPage: page, [listKey]: rows.map((r) => toApi(r)) });
  });

  router.get("/:id", ...guard(roles.read), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
    const { rows } = await query(`select * from ${table} where id = $1`, [req.params.id]);
    if (!rows[0]) fail(404, notFound);
    res.json(toApi(rows[0]));
  });

  router.post("/", ...guard(roles.write), validate(createSchema), async (req, res) => {
    req.body = blanksToNull(req.body);
    const keys = Object.keys(req.body);
    const { rows } = await query(
      `insert into ${table} (${keys.map(snake).join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
      keys.map((k) => req.body[k])
    );
    res.status(201).json(toApi(rows[0]));
  });

  router.put("/:id", ...guard(roles.write), validate(Joi.object({ id: id.required() }), "params"), validate(updateSchema.min(1)), async (req, res) => {
    req.body = blanksToNull(req.body);
    const keys = Object.keys(req.body);
    const { rows } = await query(
      `update ${table} set ${keys.map((k, i) => `${snake(k)} = $${i + 2}`).join(",")} where id = $1 returning *`,
      [req.params.id, ...keys.map((k) => req.body[k])]
    );
    if (!rows[0]) fail(404, notFound);
    res.json(toApi(rows[0]));
  });

  router.delete("/:id", ...guard(roles.remove || roles.write), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
    const { rowCount } = await query(`delete from ${table} where id = $1`, [req.params.id]);
    if (!rowCount) fail(404, notFound);
    res.json({ message: "Deleted" });
  });

  return router;
};

module.exports.listQuery = listQuery;
module.exports.likeParam = likeParam;
