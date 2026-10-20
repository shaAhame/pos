const router = require("express").Router();
const { User } = require("../models/user");
const bcrypt = require("bcrypt");
const Joi = require("joi");

// Login route
router.post("/", async (req, res) => {
	try {
		// Validate the request body
		const { error } = validate(req.body);
		if (error) return res.status(400).send({ message: error.details[0].message });

		// Find the user by email
		const user = await User.findOne({ email: req.body.email });
		if (!user) return res.status(401).send({ message: "Invalid Email or Password" });

		// Check if the password is correct
		const validPassword = await bcrypt.compare(req.body.password, user.password);
		if (!validPassword) return res.status(401).send({ message: "Invalid Email or Password" });

		// Generate authentication token
		const token = user.generateAuthToken();
		res.status(200).send({ data: token, message: "Logged in successfully" });
	} catch (error) {
		console.error("Login error:", error); // Log error for debugging
		res.status(500).send({ message: "Internal Server Error" });
	}
});

// Validation schema
const validate = (data) => {
	const schema = Joi.object({
		email: Joi.string().email().required().label("Email"),
		password: Joi.string().required().label("Password"),
	});
	return schema.validate(data);
};

module.exports = router;
