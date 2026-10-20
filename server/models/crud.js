// Builds standard list/create/update/delete routes for a simple table.
const express = require("express");
const { query } = require("../db");
const { snake, toApi, isId, dbError } = require("./util");

module.exports = function crudRouter({ table, listKey, fields, searchFields, notFound = "Not found", extend }) {
  const router = express.Router();
  const sortable = new Set(["createdAt", ...fields]); // whitelist: never put user text into SQL

  const pick = (body) => {
    const cols = [], vals = [];
    for (const f of fields) {
      if (body && Object.prototype.hasOwnProperty.call(body, f)) {
        let v = body[f];
        if (typeof v === "string") v = v.trim();
        if (v === "") v = null;
        cols.push(snake(f));
        vals.push(v);
      }
    }
    return { cols, vals };
  };

  if (extend) extend(router);

  router.post("/", async (req, res) => {
    const { cols, vals } = pick(req.body);
    if (!cols.length) return res.status(400).json({ error: "No data" });
    try {
      const { rows } = await query(
        `insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
        vals
      );
      res.status(201).json(toApi(rows[0]));
    } catch (e) { dbError(res, e); }
  });

  router.get("/", async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const sortBy = sortable.has(req.query.sortBy) ? snake(req.query.sortBy) : "name";
    const order = req.query.order === "desc" ? "desc" : "asc";
    const filter = (req.query.filter || "").trim();
    const where = filter ? `where ${searchFields.map((f) => `${snake(f)} ilike $1`).join(" or ")}` : "";
    const params = filter ? ["%" + filter.replace(/[\\%_]/g, (c) => "\\" + c) + "%"] : [];
    try {
      const total = (await query(`select count(*)::int as n from ${table} ${where}`, params)).rows[0].n;
      const { rows } = await query(
        `select * from ${table} ${where} order by ${sortBy} ${order}, id limit ${limit} offset ${(page - 1) * limit}`,
        params
      );
      res.status(200).json({ total, totalPages: Math.ceil(total / limit), currentPage: page, [listKey]: rows.map(toApi) });
    } catch (e) { dbError(res, e); }
  });

  router.put("/:id", async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: notFound });
    const { cols, vals } = pick(req.body);
    if (!cols.length) return res.status(400).json({ error: "No data" });
    try {
      const { rows } = await query(
        `update ${table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(",")} where id = $1 returning *`,
        [req.params.id, ...vals]
      );
      if (!rows[0]) return res.status(404).json({ error: notFound });
      res.status(200).json(toApi(rows[0]));
    } catch (e) { dbError(res, e); }
  });

  router.delete("/:id", async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: notFound });
    try {
      const { rowCount } = await query(`delete from ${table} where id = $1`, [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: notFound });
      res.status(200).json({ message: "Deleted successfully" });
    } catch (e) { dbError(res, e); }
  });

  return router;
};
