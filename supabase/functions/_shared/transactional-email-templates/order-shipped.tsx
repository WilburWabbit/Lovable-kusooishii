/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.tsx'

const SITE_NAME = 'Kuso Oishii'
const SITE_URL = 'https://www.kusooishii.com'
const LOGO_URL = 'https://www.kusooishii.com/lovable-uploads/bd7eeb10-aa45-4885-9059-16107ecc9a19.png'

interface OrderShippedProps {
  orderNumber?: string
  trackingNumber?: string
  shippingCarrier?: string
}

const OrderShippedEmail = ({
  orderNumber = 'KO-000',
  trackingNumber,
  shippingCarrier,
}: OrderShippedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your order has shipped - {orderNumber}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt="KUSO OISHII" width="120" style={logo} />
        <Heading style={h1}>On its way.</Heading>
        <Text style={text}>
          Your order <strong>{orderNumber}</strong> has been shipped
          {shippingCarrier ? ` via ${shippingCarrier}` : ''}.
          {trackingNumber
            ? ' Your tracking number is:'
            : ' Tracking info will follow once available.'}
        </Text>

        {trackingNumber && (
          <Text style={trackingStyle}>
            {trackingNumber}
          </Text>
        )}

        <Button style={button} href={`${SITE_URL}/order-tracking`}>
          Track your order
        </Button>

        <Text style={footer}>
          Questions? Reply to this email or contact us at contact@kusooishii.com
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: OrderShippedEmail,
  subject: (data: Record<string, any>) =>
    `Your order has shipped - ${data.orderNumber || 'KO-000'}`,
  displayName: 'Order shipped',
  previewData: {
    orderNumber: 'KO-1042',
    trackingNumber: 'RM1234567890GB',
    shippingCarrier: 'Royal Mail',
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
const text = {
  fontSize: '15px',
  color: 'hsl(0, 0%, 42%)',
  lineHeight: '1.6',
  margin: '0 0 28px',
}
const trackingStyle = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: 'hsl(0, 72%, 46%)',
  letterSpacing: '2px',
  textAlign: 'center' as const,
  backgroundColor: '#f9f9f9',
  borderRadius: '4px',
  padding: '16px',
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
