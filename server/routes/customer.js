const crud = require("../models/crud");
module.exports = crud({
  table: "customers", listKey: "customers", notFound: "Customer not found",
  fields: ["name", "contactNumber", "email", "address"],
  searchFields: ["name", "contactNumber"],
});
