const { camel } = require("./util");

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

const friendlyField = (constraint = "") => {
  const map = {
    products_biz_barcode_key: "Barcode",
    users_email_key: "Email",
    platform_users_email_key: "Email",
    employees_biz_email_key: "Email",
    suppliers_biz_email_key: "Email",
    locations_biz_name_key: "A branch with that name",
    serials_biz_serial_key: "Serial number",
    shifts_one_open_per_user: "Open shift",
  };
  return map[constraint] || "Value";
};

// Express 5 error handler: turns any thrown error into a clean JSON response.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, ...err.extra });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON" });
  if (err.type === "entity.too.large") return res.status(413).json({ message: "Request too large" });
  switch (err.code) {
    case "23505": return res.status(409).json({ message: `${friendlyField(err.constraint)} already exists` });
    case "23502": return res.status(400).json({ message: `${camel(err.column || "field")} is required` });
    case "23503": return res.status(409).json({ message: "This record is linked to other records and can't be changed that way" });
    case "23514":
    case "22P02":
    case "22003":
    case "22007": return res.status(400).json({ message: "Invalid value" });
  }
  // Database unreachable -> 503 so the till knows to save the sale offline.
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "57P01", "57P03", "08006", "08001"].includes(err.code) ||
      /timeout exceeded when trying to connect|Connection terminated/i.test(err.message || "")) {
    console.error("Database unavailable:", err.message);
    return res.status(503).json({ message: "Database unavailable", code: "DB_UNAVAILABLE" });
  }
  console.error(err);
  res.status(500).json({ message: "Something went wrong. Please try again." });
};

module.exports = { HttpError, fail, errorHandler };
