const crud = require("../models/crud");
const { query } = require("../db");
const { toApi, dbError } = require("../models/util");

module.exports = crud({
  table: "products", listKey: "products", notFound: "Product not found",
  fields: ["name", "description", "category", "price", "barcode", "quantity"],
  searchFields: ["name", "description", "barcode"],
  extend: (router) => {
    // Look up a single product by barcode (used by the till's scanner)
    router.get("/barcode/:code", async (req, res) => {
      try {
        const { rows } = await query("select * from products where barcode = $1", [req.params.code.trim()]);
        if (!rows[0]) return res.status(404).json({ error: "No product with that barcode" });
        res.status(200).json(toApi(rows[0]));
      } catch (e) { dbError(res, e); }
    });
  },
});
