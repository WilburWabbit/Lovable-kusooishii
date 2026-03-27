// Edge function: submit-contact-form
// Accepts contact form submissions from the storefront (anon key),
// stores them in the contact_messages table, and triggers a notification
// email to the store owner via the existing transactional email pipeline.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Simple in-memory rate limiter (per-instance; resets on cold start)
const submissions = new Map<string, number[]>()
const RATE_LIMIT = 3 // max submissions
const RATE_WINDOW_MS = 10 * 60 * 1000 // per 10 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const timestamps = (submissions.get(ip) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS
  )
  if (timestamps.length >= RATE_LIMIT) return true
  timestamps.push(now)
  submissions.set(ip, timestamps)
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Basic rate limiting by IP
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  if (isRateLimited(clientIp)) {
    return new Response(
      JSON.stringify({ error: 'Too many submissions. Please try again later.' }),
      {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Parse & validate body
  let name: string, email: string, subject: string, message: string
  try {
    const body = await req.json()
    name = (body.name ?? '').trim()
    email = (body.email ?? '').trim()
    subject = (body.subject ?? '').trim()
    message = (body.message ?? '').trim()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!name || !email || !subject || !message) {
    return new Response(
      JSON.stringify({ error: 'All fields are required.' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      JSON.stringify({ error: 'Invalid email address.' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Truncate message to prevent abuse
  if (message.length > 5000) {
    message = message.slice(0, 5000)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 1. Store the message
  const { error: insertError } = await supabase
    .from('contact_messages')
    .insert({ name, email, subject, message })

  if (insertError) {
    console.error('Failed to store contact message', insertError)
    // Don't fail the user — still try to send the email
  }

  // 2. Trigger notification email via send-transactional-email
  try {
    const emailRes = await fetch(
      `${supabaseUrl}/functions/v1/send-transactional-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          templateName: 'contact-form',
          templateData: { name, email, subject, message },
        }),
      }
    )

    if (!emailRes.ok) {
      const errBody = await emailRes.text()
      console.error('Email send failed', emailRes.status, errBody)
    }
  } catch (err) {
    console.error('Email send threw', err)
  }

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
