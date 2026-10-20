import React from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import axios from "axios";

const stripePromise = loadStripe("your_stripe_public_key");

const CheckoutForm = ({ amount, onSuccess }) => {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!stripe || !elements) {
      console.error("Stripe has not loaded yet.");
      return;
    }

    try {
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: "card",
        card: elements.getElement(CardElement),
      });

      if (error) {
        console.error("Payment error:", error.message);
        return;
      }

      const response = await axios.post("/api/payments/charge", {
        amount,
        paymentMethodId: paymentMethod.id,
      });

      if (response.data.success) {
        onSuccess();
      } else {
        console.error("Payment failed:", response.data.message);
      }
    } catch (err) {
      console.error("Payment processing error:", err);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <CardElement />
      <button type="submit" disabled={!stripe}>Pay Rs. {amount}</button>
    </form>
  );
};

const PaymentForm = ({ amount, onSuccess }) => (
  <Elements stripe={stripePromise}>
    <CheckoutForm amount={amount} onSuccess={onSuccess} />
  </Elements>
);

export default PaymentForm;
