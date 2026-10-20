const router = require("express").Router();
const bcrypt = require("bcrypt");
const Joi = require("joi");
const { query } = require("../db");
const { generateAuthToken } = require("../models/user");

// Login
router.post("/", async (req, res) => {
	try {
		const { error } = validate(req.body);
		if (error) return res.status(400).send({ message: error.details[0].message });

		const { rows } = await query("select * from users where lower(email) = lower($1)", [req.body.email]);
		const user = rows[0];
		if (!user) return res.status(401).send({ message: "Invalid Email or Password" });

		const validPassword = await bcrypt.compare(req.body.password, user.password);
		if (!validPassword) return res.status(401).send({ message: "Invalid Email or Password" });

		res.status(200).send({ data: generateAuthToken(user), message: "Logged in successfully" });
	} catch (error) {
		console.error("Login error:", error);
		res.status(500).send({ message: "Internal Server Error" });
	}
});

const validate = (data) => {
	const schema = Joi.object({
		email: Joi.string().email().required().label("Email"),
		password: Joi.string().required().label("Password"),
	});
	return schema.validate(data);
};

module.exports = router;
