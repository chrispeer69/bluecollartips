import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secrets = [
          process.env.STRIPE_WEBHOOK_SECRET,
          process.env.STRIPE_LIVE_WEBHOOK_SECRET,
          process.env.STRIPE_TEST_WEBHOOK_SECRET,
        ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
        const sig = request.headers.get("stripe-signature");
        const body = await request.text();
        if (!secrets.length || !sig) return new Response("Not configured", { status: 400 });

        const { getStripe } = await import("@/lib/stripe.server");
        const stripe = getStripe();
        if (!stripe) return new Response("Stripe not configured", { status: 500 });

        let event: Stripe.Event | null = null;
        for (const secret of secrets) {
          try {
            event = stripe.webhooks.constructEvent(body, sig, secret);
            break;
          } catch {
            // Live and sandbox destinations have different signing secrets.
          }
        }
        if (!event) return new Response("Invalid Stripe signature", { status: 400 });

        const { db } = await import("@/db/client.server");

        if (event.type === "payment_intent.succeeded") {
          const pi = event.data.object as {
            id: string;
            amount: number;
            metadata?: Record<string, string>;
            status: string;
          };
          try {
            const { recordSuccessfulStripeTip } = await import("@/lib/stripe-tip-ledger.server");
            const recorded = await recordSuccessfulStripeTip(db, pi);
            const driverId = recorded.driverId;
            const companyId = recorded.companyId;

            // Webhook retries are normal. Only send notifications the first
            // time this PaymentIntent becomes a verified ledger entry.
            if (recorded.recorded && driverId) try {
              const { sendThankYou } = await import("@/lib/thankyou.server");
              await sendThankYou(db, {
                companyId,
                driverId,
                stars: Number(pi.metadata?.stars ?? 5),
                tipCents: pi.amount,
                customerName: pi.metadata?.customer_name || null,
                customerPhone: pi.metadata?.customer_phone || null,
                customerEmail: pi.metadata?.customer_email || null,
              });
            } catch (e) {
              console.error("thank-you (stripe webhook) failed", e);
            }
            // Notify the employee and send the customer a receipt.
            if (recorded.recorded && driverId) try {
              const { notifyEmployee, sendCustomerReceipt } = await import("@/lib/notify.server");
              await notifyEmployee(db, {
                companyId,
                driverId,
                kind: "tip",
                amountCents: pi.amount,
                stars: pi.metadata?.stars ? Number(pi.metadata.stars) : null,
                customerName: pi.metadata?.customer_name || null,
              });
              await sendCustomerReceipt(db, {
                companyId,
                driverId,
                customerPhone: pi.metadata?.customer_phone || null,
                customerEmail: pi.metadata?.customer_email || null,
                amountCents: pi.amount,
              });
            } catch (e) {
              console.error("notify/receipt (stripe webhook) failed", e);
            }
          } catch (e) {
            console.error("stripe tip ledger write failed", e);
            return new Response("Could not record tip", { status: 500 });
          }
        } else if (event.type === "account.updated") {
          const acct = event.data.object as {
            id: string;
            charges_enabled?: boolean;
            payouts_enabled?: boolean;
          };
          const { error } = await db
            .from("drivers")
            .update({
              stripe_charges_enabled: !!acct.charges_enabled,
              stripe_payouts_enabled: !!acct.payouts_enabled,
            })
            .eq("stripe_account_id", acct.id);
          if (error) {
            console.error("stripe account status update failed", error);
            return new Response("Could not update Stripe account", { status: 500 });
          }
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
