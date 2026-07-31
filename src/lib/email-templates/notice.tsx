import React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  companyName?: string
  heading?: string
  preview?: string
  lines?: string[]
  ctaUrl?: string
  ctaLabel?: string
  footerNote?: string
}

const Email = ({
  companyName = 'Blue Collar Tips',
  heading = 'Update',
  preview,
  lines = [],
  ctaUrl,
  ctaLabel,
  footerNote,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{preview || heading}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{companyName}</Text>
        <Heading style={h1}>{heading}</Heading>
        {lines.map((line, i) => (
          <Text key={i} style={text}>
            {line}
          </Text>
        ))}
        {ctaUrl && (
          <Section style={{ margin: '28px 0 8px' }}>
            <Button href={ctaUrl} style={button}>
              {ctaLabel || 'Open'}
            </Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={small}>
          {footerNote || 'Sent by Blue Collar Tips, a product of Blue Collar AI, Inc.'}
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    (data?.subject as string) || 'Update from Blue Collar Tips',
  displayName: 'Branded notice',
  previewData: {
    companyName: 'Roadside Towing',
    subject: 'You just got a tip',
    heading: 'You just got a $20.00 tip',
    lines: ['A customer rated you 5 stars and left a tip.', 'Nice work out there.'],
    ctaUrl: 'https://roadsidetips.lovable.app/dashboard/driver',
    ctaLabel: 'View my earnings',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '28px 24px', maxWidth: '560px' }
const brand = {
  fontSize: '12px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: '#64748b',
  margin: '0 0 6px',
}
const h1 = { fontSize: '22px', lineHeight: '1.3', color: '#0b2545', margin: '0 0 14px' }
const text = { fontSize: '15px', lineHeight: '1.6', color: '#1f2937', margin: '0 0 10px' }
const button = {
  backgroundColor: '#0b2545',
  color: '#ffffff',
  borderRadius: '8px',
  padding: '12px 22px',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
}
const hr = { borderColor: '#e5e7eb', margin: '28px 0 14px' }
const small = { fontSize: '12px', color: '#64748b', margin: 0 }