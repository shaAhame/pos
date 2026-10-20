const router = require("express").Router();
const bcrypt = require("bcrypt");
const { query } = require("../db");
const { validate } = require("../models/user");
const auth = require("../middleware/auth");

// Anyone may create the very first account (shop setup).
// After that, only a logged-in user can add new accounts.
const requireLoginUnlessFirstUser = async (req, res, next) => {
	try {
		const { rows } = await query("select exists(select 1 from users) as any");
		if (!rows[0].any) return next();
		return auth(req, res, next);
	} catch (err) {
		next(err);
	}
};

router.post("/", requireLoginUnlessFirstUser, async (req, res) => {
	try {
		const { error } = validate(req.body);
		if (error) return res.status(400).send({ message: error.details[0].message });

		const saltRounds = Number(process.env.SALT) || 10;
		const hashPassword = await bcrypt.hash(req.body.password, saltRounds);

		await query(
			"insert into users (first_name, last_name, email, password) values ($1, $2, $3, $4)",
			[req.body.firstName.trim(), req.body.lastName.trim(), req.body.email.trim(), hashPassword]
		);
		res.status(201).send({ message: "User created successfully" });
	} catch (error) {
		if (error.code === "23505") return res.status(409).send({ message: "User with given email already exists!" });
		console.error("Error creating user:", error);
		res.status(500).send({ message: "Internal Server Error" });
	}
});

module.exports = router;
