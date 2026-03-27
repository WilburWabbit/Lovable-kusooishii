/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Img, Preview, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.tsx'

const SITE_NAME = 'Kuso Oishii'
const LOGO_URL = 'https://www.kusooishii.com/lovable-uploads/bd7eeb10-aa45-4885-9059-16107ecc9a19.png'

interface ContactFormProps {
  name: string
  email: string
  subject: string
  message: string
}

const ContactFormEmail = ({ name, email, subject, message }: ContactFormProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Contact form: {subject} from {name}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt="KUSO OISHII" width="120" style={logo} />
        <Heading style={h1}>New contact form message</Heading>
        <Text style={label}>From</Text>
        <Text style={value}>{name} ({email})</Text>
        <Text style={label}>Subject</Text>
        <Text style={value}>{subject}</Text>
        <Hr style={hr} />
        <Text style={label}>Message</Text>
        <Text style={messageStyle}>{message}</Text>
        <Hr style={hr} />
        <Text style={footer}>
          Reply directly to this email to respond to {name} at {email}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: ContactFormEmail,
  subject: (data) => `[Contact] ${data.subject || 'New message'} — ${data.name || 'Unknown'}`,
  to: Deno.env.get('CONTACT_EMAIL') || 'hello@kusooishii.com',
  displayName: 'Contact form notification',
  previewData: {
    name: 'Alex Builder',
    email: 'alex@example.com',
    subject: 'Order issue',
    message: 'Hi, I received my order but the box was more damaged than described. Can we sort this out?',
  },
}

const main = { backgroundColor: '#ffffff', fontFamily: "'Space Grotesk', 'Noto Sans JP', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const logo = { marginBottom: '24px' } as React.CSSProperties
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: 'hsl(0, 0%, 12%)',
  margin: '0 0 20px',
}
const label = {
  fontSize: '12px',
  fontWeight: '600' as const,
  color: 'hsl(0, 0%, 55%)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  margin: '16px 0 4px',
}
const value = {
  fontSize: '15px',
  color: 'hsl(0, 0%, 12%)',
  lineHeight: '1.4',
  margin: '0 0 8px',
}
const messageStyle = {
  fontSize: '15px',
  color: 'hsl(0, 0%, 25%)',
  lineHeight: '1.6',
  margin: '0 0 16px',
  whiteSpace: 'pre-wrap' as const,
}
const hr = { borderColor: '#e5e5e5', margin: '20px 0' }
const footer = { fontSize: '12px', color: '#999999', margin: '16px 0 0' }
