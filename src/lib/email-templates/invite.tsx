import React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  recipientName?: string
  companyName?: string
  inviteUrl?: string
  inviteCode?: string
  role?: 'company_admin' | 'driver' | string
}

const InviteEmail = ({
  recipientName,
  companyName = 'Blue Collar Tips',
  inviteUrl = 'https://bluecollartips.app',
  inviteCode = '',
  role = 'company_admin',
}: Props) => {
  const isAdmin = role === 'company_admin'
  const headline = isAdmin
    ? `You've been invited to run ${companyName} on Blue Collar Tips`
    : `You've been added as a driver at ${companyName}`
  const intro = isAdmin
    ? `You've been set up as the admin for ${companyName}. Click the button below to activate your account, add your team, and start collecting tips.`
    : `${companyName} added you as a driver on Blue Collar Tips. Click the button below to activate your profile and start receiving tips from customers.`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{headline}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Blue Collar Tips</Heading>
          <Text style={greeting}>Hi {recipientName || 'there'},</Text>
          <Heading as="h2" style={h2}>
            {headline}
          </Heading>
          <Text style={paragraph}>{intro}</Text>
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={inviteUrl} style={button}>
              Activate your account
            </Button>
          </Section>
          <Text style={smallMuted}>
            Or open this link in your browser:
            <br />
            <Link href={inviteUrl} style={link}>
              {inviteUrl}
            </Link>
          </Text>
          {inviteCode && (
            <Text style={smallMuted}>
              Invite code: <strong>{inviteCode}</strong>
            </Text>
          )}
          <Hr style={hr} />
          <Text style={footer}>
            This invite was sent by Blue Collar Tips. If you weren't expecting it,
            you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: InviteEmail,
  subject: (data: Record<string, any>) =>
    data?.role === 'driver'
      ? `You've been added as a driver at ${data?.companyName ?? 'your company'}`
      : `You're invited to manage ${data?.companyName ?? 'your company'} on Blue Collar Tips`,
  displayName: 'Invite (admin or driver)',
  previewData: {
    recipientName: 'Jane',
    companyName: 'Acme Roadside',
    inviteUrl: 'https://bluecollartips.app/join/ABC123',
    inviteCode: 'ABC123',
    role: 'company_admin',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '32px 24px',
}
const h1 = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#0f172a',
  margin: '0 0 24px',
  letterSpacing: '-0.01em',
}
const h2 = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#0f172a',
  margin: '0 0 16px',
  lineHeight: '1.3',
}
const greeting = { fontSize: '16px', color: '#0f172a', margin: '0 0 8px' }
const paragraph = {
  fontSize: '15px',
  color: '#334155',
  lineHeight: '1.6',
  margin: '0 0 16px',
}
const button = {
  backgroundColor: '#2563eb',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
}
const link = { color: '#2563eb', wordBreak: 'break-all' as const }
const smallMuted = {
  fontSize: '13px',
  color: '#64748b',
  lineHeight: '1.6',
  margin: '8px 0',
}
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', lineHeight: '1.5' }