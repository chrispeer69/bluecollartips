import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useServerFn } from "@tanstack/react-start";
import { createTipPaymentIntent, finalizeTipPayment, getStripePublishableKey } from "@/lib/stripe.functions";
import { dollars } from "@/lib/constants";

const PAYMENT_METHOD_NAMES: Record<string, string> = {
  affirm: "Affirm",
  afterpay_clearpay: "Afterpay / Clearpay",
  amazon_pay: "Amazon Pay",
  cashapp: "Cash App Pay",
  card: "card",
  klarna: "Klarna",
  link: "Link",
  paypal: "PayPal",
  us_bank_account: "a bank account",
};

function paymentMethodName(method: string | null) {
  if (!method) return "securely";
  return PAYMENT_METHOD_NAMES[method] ?? method.replaceAll("_", " ");
}

type Props = {
  companySlug: string;
  driverSlug?: string | null;
  amountCents: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  stars?: number | null;
  brandColor: string;
  onPaid: () => void;
};

export function StripeCardPanel(props: Props) {
  const getKey = useServerFn(getStripePublishableKey);
  const createPi = useServerFn(createTipPaymentIntent);
  const finalizePi = useServerFn(finalizeTipPayment);
  const [pk, setPk] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
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
        customerPhone: props.customerPhone ?? null,
        customerEmail: props.customerEmail ?? null,
        stars: props.stars ?? null,
      },
    })
      .then((r) => {
        setClientSecret(r.clientSecret as string);
        setPaymentIntentId(r.paymentIntentId);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Online payment is not available"));
  }, [pk, props.amountCents, props.companySlug, props.driverSlug, props.customerName, props.customerPhone, props.customerEmail, props.stars, createPi]);

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (pk ? loadStripe(pk) : null),
    [pk],
  );

  if (err) return <p className="mt-3 text-sm text-destructive">{err}</p>;
  if (!pk) return <p className="mt-3 text-xs text-muted-foreground">Online payments are not enabled yet on this platform.</p>;
  if (!stripePromise || !clientSecret) return <p className="mt-3 text-sm text-muted-foreground">Preparing secure payment options…</p>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <CardForm
        {...props}
        clientSecret={clientSecret}
        paymentIntentId={paymentIntentId}
        finalizePayment={finalizePi}
      />
    </Elements>
  );
}

function CardForm({
  amountCents,
  brandColor,
  onPaid,
  clientSecret,
  paymentIntentId,
  finalizePayment,
}: Props & {
  clientSecret: string;
  paymentIntentId: string | null;
  finalizePayment: (options: {
    data: { paymentIntentId: string; clientSecret: string };
  }) => Promise<{ ok: boolean }>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [paymentDetailsComplete, setPaymentDetailsComplete] = useState(false);
  const cashAppAttemptStarted = useRef(false);

  const pay = useCallback(async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    setBusy(false);
    if (error) {
      setErr(error.message ?? "Payment could not be completed");
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      if (!paymentIntentId) {
        setErr("Payment received. Your balance is still being updated.");
        return;
      }
      try {
        await finalizePayment({ data: { paymentIntentId, clientSecret } });
        onPaid();
      } catch {
        setErr("Payment received. Your balance is still being updated.");
      }
    } else if (paymentIntent?.status === "processing") {
      setNotice("Payment submitted. Your tip will appear after the payment provider confirms it.");
    }
  }, [clientSecret, elements, finalizePayment, onPaid, paymentIntentId, stripe]);

  useEffect(() => {
    if (paymentMethod !== "cashapp") {
      cashAppAttemptStarted.current = false;
      return;
    }
    if (!paymentDetailsComplete || cashAppAttemptStarted.current || busy) return;

    // Cash App has no details to type. Confirm as soon as it is selected so
    // Stripe can immediately display its desktop QR (or open the mobile app).
    cashAppAttemptStarted.current = true;
    void pay();
  }, [busy, pay, paymentDetailsComplete, paymentMethod]);

  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <PaymentElement
        options={{
          layout: {
            type: "accordion",
            defaultCollapsed: false,
            radios: "always",
            spacedAccordionItems: true,
            // Display every eligible method instead of putting later methods
            // behind Stripe's default "More" control.
            visibleAccordionItemsCount: 0,
          },
        }}
        onChange={(event) => {
          setPaymentMethod(event.value.type);
          setPaymentDetailsComplete(event.complete);
        }}
      />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {notice && <p className="mt-2 text-sm text-muted-foreground" role="status">{notice}</p>}
      {paymentMethod === "cashapp" ? (
        err ? (
          <button
            type="button"
            onClick={() => void pay()}
            disabled={busy || !stripe}
            className="mt-3 w-full rounded-md px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: brandColor }}
          >
            {busy ? "Processing…" : "Try Cash App Pay again"}
          </button>
        ) : (
          <p className="mt-3 text-center text-sm text-muted-foreground">
            {busy ? "Opening Cash App Pay…" : "Select Cash App Pay to display the QR code."}
          </p>
        )
      ) : (
        <button
          type="button"
          onClick={() => void pay()}
          disabled={busy || !stripe || !paymentDetailsComplete}
          className="mt-3 w-full rounded-md px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: brandColor }}
        >
          {busy ? "Processing…" : `Pay ${dollars(amountCents)} with ${paymentMethodName(paymentMethod)}`}
        </button>
      )}
    </div>
  );
}
