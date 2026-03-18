/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src="https://gcgrwujfyurgetvqlmbf.supabase.co/storage/v1/object/public/media/email-assets%2Fkuso-logo.png"
          alt="KUSO OISHII"
          width="120"
          style={logo}
        />
        <Heading style={h1}>Verification code</Heading>
        <Text style={text}>Use this code to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code expires shortly. Didn't request it? Ignore this.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Space Grotesk', 'Noto Sans JP', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const logo = { marginBottom: '24px' }
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
const codeStyle = {
  fontFamily: "'Space Grotesk', Courier, monospace",
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: 'hsl(0, 72%, 46%)',
  margin: '0 0 32px',
  letterSpacing: '4px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '32px 0 0' }
