import { useEffect, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useServerFn } from "@tanstack/react-start";
import { createTipPaymentIntent, getStripePublishableKey } from "@/lib/stripe.functions";
import { dollars } from "@/lib/constants";

type Props = {
  companySlug: string;
  driverSlug: string;
  amountCents: number;
  customerName?: string | null;
  brandColor: string;
  onPaid: () => void;
};

export function StripeCardPanel(props: Props) {
  const getKey = useServerFn(getStripePublishableKey);
  const createPi = useServerFn(createTipPaymentIntent);
  const [pk, setPk] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getKey().then((r) => setPk(r.publishableKey));
  }, [getKey]);

  useEffect(() => {
    if (!pk) return;
    createPi({
      data: {
        companySlug: props.companySlug,
        driverSlug: props.driverSlug,
        amountCents: props.amountCents,
        customerName: props.customerName ?? null,
      },
    })
      .then((r) => setClientSecret(r.clientSecret as string))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Card not available"));
  }, [pk, props.amountCents, props.companySlug, props.driverSlug, props.customerName, createPi]);

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (pk ? loadStripe(pk) : null),
    [pk],
  );

  if (err) return <p className="mt-3 text-sm text-destructive">{err}</p>;
  if (!pk) return <p className="mt-3 text-xs text-muted-foreground">Card payments are not enabled yet on this platform.</p>;
  if (!stripePromise || !clientSecret) return <p className="mt-3 text-sm text-muted-foreground">Preparing secure card form…</p>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <CardForm {...props} />
    </Elements>
  );
}

function CardForm({ amountCents, brandColor, onPaid }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    setBusy(false);
    if (error) {
      setErr(error.message ?? "Card declined");
      return;
    }
    if (paymentIntent?.status === "succeeded") onPaid();
  }

  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <PaymentElement />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      <button
        type="button"
        onClick={pay}
        disabled={busy || !stripe}
        className="mt-3 w-full rounded-md px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: brandColor }}
      >
        {busy ? "Charging…" : `Pay ${dollars(amountCents)} by card`}
      </button>
    </div>
  );
}