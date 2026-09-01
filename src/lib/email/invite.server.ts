import * as React from 'react'
import { render } from '@react-email/render'
import { TEMPLATES } from '@/lib/email-templates/registry'
import { db } from '@/db/client.server'
import { sendEmail } from './send.server'

const SITE_NAME = 'Blue Collar Tips'
const SENDER_DOMAIN = 'notify.bluecollarai.online'
const FROM_DOMAIN = 'bluecollarai.online'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function getOrCreateUnsubscribeToken(email: string): Promise<string> {
  const normalized = email.toLowerCase()
  const { data: existing } = await db
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalized)
    .maybeSingle()
  if (existing && !existing.used_at) return existing.token
  const token = generateToken()
  await db
    .from('email_unsubscribe_tokens')
    .upsert({ token, email: normalized }, { onConflict: 'email', ignoreDuplicates: true })
  const { data: stored } = await db
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', normalized)
    .maybeSingle()
  return stored?.token ?? token
}

export interface SendInviteEmailArgs {
  to: string
  templateName?: string
  templateData: Record<string, any>
  idempotencyKey: string
}

/**
 * Server-only helper that renders a registered template and enqueues it
 * for the email dispatcher. Callable from server functions without a JWT
 * because it uses the service role and checks caller auth upstream.
 */
export async function enqueueTransactionalEmail(args: SendInviteEmailArgs) {
  const templateName = args.templateName ?? 'invite'
  const template = TEMPLATES[templateName]
  if (!template) throw new Error(`Template not found: ${templateName}`)

  const to = args.to
  const normalized = to.toLowerCase()
  const messageId = crypto.randomUUID()

  // Suppression check
  const { data: suppressed } = await db
    .from('suppressed_emails')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()
  if (suppressed) {
    await db.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: to,
      status: 'suppressed',
    })
    return { queued: false, reason: 'suppressed' as const }
  }

  const unsubscribeToken = await getOrCreateUnsubscribeToken(to)

  const element = React.createElement(template.component, args.templateData)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(args.templateData)
      : template.subject

  await db.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: to,
    status: 'pending',
  })

  try {
    const result = await sendEmail({ to, subject, html, text })
    await db.from('email_send_log').insert({
      message_id: messageId, template_name: templateName, recipient_email: to,
      status: result.sent ? 'sent' : 'skipped', metadata: { provider_id: result.id, unsubscribe_token: unsubscribeToken },
    })
  } catch (error) {
    await db.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: to,
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  return { queued: false, sent: true, messageId }
}
