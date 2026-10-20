const crud = require("../models/crud");
module.exports = crud({
  table: "suppliers", listKey: "suppliers", notFound: "Supplier not found",
  fields: ["name", "company", "contactNumber", "email", "address"],
  searchFields: ["name", "contactNumber"],
});
