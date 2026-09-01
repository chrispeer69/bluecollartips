export async function sendSms(to: string, body: string): Promise<{ status: string; sid: string | null; error: string | null }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) return { status: "skipped", sid: null, error: "Twilio is not configured" };
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    const result = await response.json() as { sid?: string; message?: string };
    if (!response.ok) return { status: "failed", sid: null, error: result.message ?? `Twilio returned ${response.status}` };
    return { status: "sent", sid: result.sid ?? null, error: null };
  } catch (error) {
    return { status: "failed", sid: null, error: error instanceof Error ? error.message : "SMS send failed" };
  }
}
