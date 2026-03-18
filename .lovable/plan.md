

## Plan: Update auth email templates with new brand copy

The templates already have the correct styling (Torii red buttons, Space Grotesk font, logo). The changes are purely copy updates and a configuration rename in the hook.

### Changes needed

**1. Update `auth-email-hook/index.ts`**
- Change `SITE_NAME` from `"workspace-charm-market"` to `"Kuso Oishii"` (line 39)
- Update `EMAIL_SUBJECTS` to match the new subject lines (lines 19-26):
  - signup: "Welcome to the obsession"
  - invite: "You've been invited" (unchanged)
  - magiclink: "Your login link" (unchanged)
  - recovery: "Reset your password" (unchanged)
  - email_change: "Confirm your new email" (unchanged)
  - reauthentication: "Your verification code" (unchanged)

**2. Update `signup.tsx`**
- Preview: "Welcome to the obsession"
- Heading: "Welcome to the obsession."
- Body: "You signed up for Kuso Oishii. Nice one. Confirm your email and you're in -- wishlists, stock alerts, and club perks are all waiting."
- Footer: "Didn't sign up? Ignore this -- nothing happens."

**3. Update `recovery.tsx`**
- Heading: "Forgot your password? Happens to the best of us."
- Body: "Hit the button below to pick a new one for your Kuso Oishii account."
- Footer: "Didn't request this? No worries -- your password stays exactly as it is."

**4. Update `magic-link.tsx`**
- Heading: "Your login link."
- Body: "Tap below to get back to your bricks. This link won't hang around forever."
- Footer unchanged.

**5. Update `invite.tsx`**
- Heading: "Someone thinks you'd like it here."
- Body: "You've been invited to Kuso Oishii -- LEGO for grown-ups who give a shit about quality. Accept below to create your account and start browsing."
- Footer unchanged.

**6. Update `email-change.tsx`**
- Heading: "New email? Confirm it."
- Body: "You asked to change your Kuso Oishii email. Tap below to make it official."
- Footer unchanged.

**7. Update `reauthentication.tsx`**
- Heading: "Here's your code."
- Body: "Pop this in and you're sorted:"
- Footer: "Expires shortly. Didn't request it? Just ignore this."

**8. Deploy `auth-email-hook`** to activate the changes.

All template variables, styling, and logo remain untouched. No hero screenshot image exists to remove (templates only have the logo).

