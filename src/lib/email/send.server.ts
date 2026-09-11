import nodemailer from "nodemailer";

type Email = { to: string; subject: string; html: string; text?: string };

function smtpConfig() {
  const user = process.env.SMTP_USER ?? process.env.EMAIL_USER ?? process.env.EMAIL ?? process.env.email;
  const pass = process.env.SMTP_PASSWORD ?? process.env.EMAIL_PASSWORD ?? process.env.email_password;
  if (!user || !pass) return null;

  const domain = user.split("@")[1]?.toLowerCase();
  const inferred = domain === "gmail.com" || domain === "googlemail.com"
    ? { host: "smtp.gmail.com", port: 465, secure: true }
    : domain === "yahoo.com"
      ? { host: "smtp.mail.yahoo.com", port: 465, secure: true }
      : ["outlook.com", "hotmail.com", "live.com"].includes(domain ?? "")
        ? { host: "smtp.office365.com", port: 587, secure: false }
        : null;
  const host = process.env.SMTP_HOST ?? inferred?.host;
  const port = Number(process.env.SMTP_PORT ?? inferred?.port ?? 587);
  if (!host) throw new Error("SMTP_HOST is required for this email provider");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT is invalid");
  const secure = process.env.SMTP_SECURE == null
    ? (inferred?.secure ?? port === 465)
    : process.env.SMTP_SECURE.toLowerCase() === "true";
  return { user, pass, host, port, secure };
}

export async function sendEmail(message: Email) {
  const smtp = smtpConfig();
  if (smtp) {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const result = await transporter.sendMail({
      from: `Blue Collar Tips <${smtp.user}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { sent: true, id: result.messageId ?? null };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn(`[email] Not sent to ${message.to}: SMTP credentials or Resend configuration is missing`);
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
