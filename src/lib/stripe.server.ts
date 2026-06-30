import Stripe from "stripe";

let _stripe: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (_stripe !== undefined) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    _stripe = null;
    return null;
  }
  _stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion });
  return _stripe;
}

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}