type Email = { to: string; subject: string; html: string; text?: string };

export async function sendEmail(message: Email) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn(`[email] Not sent to ${message.to}: RESEND_API_KEY or EMAIL_FROM is missing`);
    return { sent: false, id: null };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
  });
  const result = await response.json() as { id?: string; message?: string };
  if (!response.ok) throw new Error(result.message ?? `Email provider returned ${response.status}`);
  return { sent: true, id: result.id ?? null };
}
