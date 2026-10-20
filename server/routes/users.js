const router = require("express").Router();
const { User, validate } = require("../models/user");
const bcrypt = require("bcrypt");

router.post("/", async (req, res) => {
	try {
		// Validate the body
		const { error } = validate(req.body);
		if (error) return res.status(400).send({ message: error.details[0].message });

		// Check if user with the given email already exists
		const user = await User.findOne({ email: req.body.email });
		if (user) return res.status(409).send({ message: "User with given email already exists!" });

		// Hash the password
		const saltRounds = Number(process.env.SALT) || 10; // Default to 10 if not set
		const salt = await bcrypt.genSalt(saltRounds);
		const hashPassword = await bcrypt.hash(req.body.password, salt);

		// Create and save the new user
		await new User({ ...req.body, password: hashPassword }).save();
		res.status(201).send({ message: "User created successfully" });
	} catch (error) {
		console.error("Error creating user:", error); // Log error for debugging
		res.status(500).send({ message: "Internal Server Error" });
	}
});

module.exports = router;
