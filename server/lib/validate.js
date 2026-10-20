const Joi = require("joi");

// Validates req.body (or req.query) against a Joi schema and replaces it with the cleaned value.
const validate = (schema, source = "body") => (req, res, next) => {
  const { error, value } = schema.validate(req[source] ?? {}, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });
  if (error) return res.status(400).json({ message: error.details[0].message.replace(/"/g, "") });
  if (source === "query") req.validQuery = value; else req[source] = value;
  next();
};

const id = Joi.string().guid({ version: ["uuidv4", "uuidv1", "uuidv5", "uuidv7"] });
const money = Joi.number().min(0).max(1e9).precision(2);
const percent = Joi.number().min(0).max(100);
const text = (max = 200) => Joi.string().trim().max(max);
const day = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).message("Dates must look like 2026-01-31");

module.exports = { Joi, validate, id, money, percent, text, day };
