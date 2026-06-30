import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        const sig = request.headers.get("stripe-signature");
        const body = await request.text();
        if (!secret || !sig) return new Response("Not configured", { status: 400 });

        const { getStripe } = await import("@/lib/stripe.server");
        const stripe = getStripe();
        if (!stripe) return new Response("Stripe not configured", { status: 500 });

        let event;
        try {
          event = stripe.webhooks.constructEvent(body, sig, secret);
        } catch (e) {
          return new Response(`Invalid signature: ${e instanceof Error ? e.message : ""}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (event.type === "payment_intent.succeeded") {
          const pi = event.data.object as {
            id: string;
            amount: number;
            metadata?: Record<string, string>;
            status: string;
          };
          const driverId = pi.metadata?.driver_id;
          const companyId = pi.metadata?.company_id;
          if (driverId && companyId) {
            await supabaseAdmin.from("tips").upsert(
              {
                company_id: companyId,
                driver_id: driverId,
                amount_cents: pi.amount,
                source: "stripe",
                stripe_payment_intent_id: pi.id,
                stripe_status: pi.status,
                verified: true,
                verified_at: new Date().toISOString(),
                customer_name: pi.metadata?.customer_name || null,
                driver_amount_cents: 0,
                company_amount_cents: 0,
                platform_amount_cents: 0,
              },
              { onConflict: "stripe_payment_intent_id" },
            );
          }
        } else if (event.type === "account.updated") {
          const acct = event.data.object as {
            id: string;
            charges_enabled?: boolean;
            payouts_enabled?: boolean;
          };
          await supabaseAdmin
            .from("drivers")
            .update({
              stripe_charges_enabled: !!acct.charges_enabled,
              stripe_payouts_enabled: !!acct.payouts_enabled,
            })
            .eq("stripe_account_id", acct.id);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});