const crud = require("../models/crud");
module.exports = crud({
  table: "employees", listKey: "employees", notFound: "Employee not found",
  fields: ["name", "position", "salary", "contactNumber", "email"],
  searchFields: ["name", "contactNumber"],
});
