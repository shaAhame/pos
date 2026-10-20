const express = require("express");
const stripe = require("stripe")("your_stripe_secret_key");
const router = express.Router();

router.post("/charge", async (req, res) => {
  try {
    const { amount, paymentMethodId } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Convert to cents (1 LKR = 100 cents)
      currency: "lkr", // Change currency to Sri Lankan Rupees
      payment_method: paymentMethodId,
      confirm: true,
    });

    res.json({ success: true, paymentIntent });
  } catch (error) {
    console.error("Payment error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

