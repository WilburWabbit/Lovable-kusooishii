/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Kuso Oishii'
const SITE_URL = 'https://www.kusooishii.com'
const LOGO_URL = 'https://www.kusooishii.com/lovable-uploads/bd7eeb10-aa45-4885-9059-16107ecc9a19.png'

interface WelcomeProps {
  displayName?: string
}

const WelcomeEmail = ({ displayName }: WelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to the obsession</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt="KUSO OISHII" width="120" style={logo} />
        <Heading style={h1}>
          {displayName ? `Welcome, ${displayName}.` : 'Welcome to the obsession.'}
        </Heading>
        <Text style={text}>
          You're in. {SITE_NAME} is where retired LEGO sets get a second life —
          graded, priced fairly, and ready for your shelf. Browse the catalog,
          build a wishlist, and get notified when the sets you want come in stock.
        </Text>
        <Button style={button} href={`${SITE_URL}/browse`}>
          Browse the catalog
        </Button>
        <Text style={footer}>
          This is a one-time welcome email. You won't hear from us unless you
          want to.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeEmail,
  subject: 'Welcome to the obsession',
  displayName: 'Welcome email',
  previewData: { displayName: 'Alex' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Space Grotesk', 'Noto Sans JP', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const logo = { marginBottom: '24px' } as React.CSSProperties
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: 'hsl(0, 0%, 12%)',
  margin: '0 0 20px',
}
const text = {
  fontSize: '15px',
  color: 'hsl(0, 0%, 42%)',
  lineHeight: '1.6',
  margin: '0 0 28px',
}
const button = {
  backgroundColor: 'hsl(0, 72%, 46%)',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  borderRadius: '4px',
  padding: '12px 24px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '32px 0 0' }
