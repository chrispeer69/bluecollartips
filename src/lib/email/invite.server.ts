import * as React from 'react'
import { render } from '@react-email/render'
import { TEMPLATES } from '@/lib/email-templates/registry'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

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
  const { data: existing } = await supabaseAdmin
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalized)
    .maybeSingle()
  if (existing && !existing.used_at) return existing.token
  const token = generateToken()
  await supabaseAdmin
    .from('email_unsubscribe_tokens')
    .upsert({ token, email: normalized }, { onConflict: 'email', ignoreDuplicates: true })
  const { data: stored } = await supabaseAdmin
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
  const { data: suppressed } = await supabaseAdmin
    .from('suppressed_emails')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()
  if (suppressed) {
    await supabaseAdmin.from('email_send_log').insert({
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

  await supabaseAdmin.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: to,
    status: 'pending',
  })

  const { error } = await supabaseAdmin.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: args.idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })
  if (error) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: to,
      status: 'failed',
      error_message: error.message,
    })
    throw new Error(`Failed to enqueue email: ${error.message}`)
  }
  return { queued: true, messageId }
}