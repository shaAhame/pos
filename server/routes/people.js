const crud = require("../lib/crud");
const { Joi, text, money } = require("../lib/validate");

const phone = text(40).pattern(/^[0-9+()\-\s]{3,40}$/).message("Contact number can only contain digits, spaces, +, - and ()");
const email = Joi.string().trim().email().max(200);

const customers = crud({
  table: "customers", listKey: "customers", notFound: "Customer not found",
  createSchema: Joi.object({ name: text(120).required(), contactNumber: phone.required(), email: email.allow("", null).empty(["", null]).default(null), address: text(300).allow("", null).empty(["", null]).default(null) }),
  updateSchema: Joi.object({ name: text(120), contactNumber: phone, email: email.allow("", null), address: text(300).allow("", null) }),
  searchFields: ["name", "contactNumber", "email"], sortable: ["contactNumber"],
  roles: { read: "cashier", write: "cashier", remove: "manager" },
});

const suppliers = crud({
  table: "suppliers", listKey: "suppliers", notFound: "Supplier not found",
  createSchema: Joi.object({ name: text(120).required(), company: text(120).required(), contactNumber: phone.required(), email: email.required(), address: text(300).required() }),
  updateSchema: Joi.object({ name: text(120), company: text(120), contactNumber: phone, email, address: text(300) }),
  searchFields: ["name", "company", "contactNumber"], sortable: ["company"],
  roles: { read: "manager", write: "manager" },
});

const employees = crud({
  table: "employees", listKey: "employees", notFound: "Employee not found",
  createSchema: Joi.object({ name: text(120).required(), position: text(80).required(), salary: money.required(), contactNumber: phone.required(), email: email.required() }),
  updateSchema: Joi.object({ name: text(120), position: text(80), salary: money, contactNumber: phone, email }),
  searchFields: ["name", "position", "contactNumber"], sortable: ["position", "salary"],
  roles: { read: "owner", write: "owner" },
});

module.exports = { customers, suppliers, employees };
