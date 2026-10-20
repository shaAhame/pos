const router = require("express").Router();
const { User, validate } = require("../models/user");
const bcrypt = require("bcrypt");
const auth = require("../middleware/auth");

// Anyone may create the very first account (shop setup).
// After that, only a logged-in user can add new accounts.
const requireLoginUnlessFirstUser = async (req, res, next) => {
	try {
		const count = await User.estimatedDocumentCount();
		if (count === 0) return next();
		return auth(req, res, next);
	} catch (err) {
		next(err);
	}
};

router.post("/", requireLoginUnlessFirstUser, async (req, res) => {
	try {
		const { error } = validate(req.body);
		if (error) return res.status(400).send({ message: error.details[0].message });

		const user = await User.findOne({ email: req.body.email });
		if (user) return res.status(409).send({ message: "User with given email already exists!" });

		const saltRounds = Number(process.env.SALT) || 10;
		const hashPassword = await bcrypt.hash(req.body.password, saltRounds);

		await new User({ ...req.body, password: hashPassword }).save();
		res.status(201).send({ message: "User created successfully" });
	} catch (error) {
		console.error("Error creating user:", error);
		res.status(500).send({ message: "Internal Server Error" });
	}
});

module.exports = router;
