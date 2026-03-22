/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Img, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Kuso Oishii'
const SITE_URL = 'https://www.kusooishii.com'
const LOGO_URL = 'https://www.kusooishii.com/lovable-uploads/bd7eeb10-aa45-4885-9059-16107ecc9a19.png'

interface OrderItem {
  name: string
  sku: string
  quantity: number
  unitPrice: string
}

interface OrderConfirmationProps {
  orderNumber?: string
  items?: OrderItem[]
  shippingName?: string
  grossTotal?: string
  currency?: string
}

const OrderConfirmationEmail = ({
  orderNumber = 'KO-000',
  items = [],
  shippingName = '',
  grossTotal = '0.00',
  currency = 'GBP',
}: OrderConfirmationProps) => {
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Order confirmed — {orderNumber}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img src={LOGO_URL} alt="KUSO OISHII" width="120" style={logo} />
          <Heading style={h1}>Order confirmed.</Heading>
          <Text style={text}>
            Nice one{shippingName ? `, ${shippingName.split(' ')[0]}` : ''}. Your order{' '}
            <strong>{orderNumber}</strong> is locked in. We'll get it packed and
            send you a shipping notification when it's on the way.
          </Text>

          {items.length > 0 && (
            <Section style={itemsSection}>
              {items.map((item, i) => (
                <Text key={i} style={itemLine}>
                  {item.name} ({item.sku}) × {item.quantity} — {symbol}{item.unitPrice}
                </Text>
              ))}
            </Section>
          )}

          <Hr style={divider} />

          <Text style={totalLine}>
            Total: <strong>{symbol}{grossTotal}</strong>
          </Text>

          <Button style={button} href={`${SITE_URL}/order-tracking`}>
            Track your order
          </Button>

          <Text style={footer}>
            Questions? Reply to this email or hit us up at contact@kusooishii.com
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: OrderConfirmationEmail,
  subject: (data: Record<string, any>) =>
    `Order confirmed — ${data.orderNumber || 'KO-000'}`,
  displayName: 'Order confirmation',
  previewData: {
    orderNumber: 'KO-1042',
    items: [
      { name: 'LEGO UCS Millennium Falcon', sku: '75192-1.2', quantity: 1, unitPrice: '549.99' },
    ],
    shippingName: 'Alex Turner',
    grossTotal: '559.98',
    currency: 'GBP',
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
const itemsSection = {
  backgroundColor: '#f9f9f9',
  borderRadius: '4px',
  padding: '16px 20px',
  margin: '0 0 20px',
}
const itemLine = {
  fontSize: '14px',
  color: 'hsl(0, 0%, 20%)',
  lineHeight: '1.8',
  margin: '0',
}
const divider = { borderColor: '#e5e5e5', margin: '20px 0' }
const totalLine = {
  fontSize: '16px',
  color: 'hsl(0, 0%, 12%)',
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
