# Competitions Engine Technical Blueprint (Gmail-first)

This document defines the implementation blueprint for a competitions engine that ingests Gmail messages, classifies competition-related emails, creates actionable workflows, and alerts users about potential wins.

## Goals (V1)

- Ingest Gmail messages reliably and idempotently.
- Classify messages into operational categories.
- Extract action fields (confirm links, deadlines, prize details, claim windows).
- Create tasks and notifications from extracted intents.
- Surface high-priority win candidates immediately.
- Maintain full auditability.

## Recommended Stack

- **App**: Next.js (App Router) + TypeScript
- **Database**: PostgreSQL
- **Queues/Jobs**: BullMQ + Redis
- **Email Provider**: Gmail API (OAuth 2.0)
- **Alerting**: Twilio (SMS), optional push/email fallback
- **Automation (Phase 2+)**: Playwright for trusted-site assisted/auto entry

## Architecture Overview

```text
Gmail API (watch + history sync)
        |
        v
Ingestion API (route handlers)
        |
        v
Raw Email Store (Postgres)
        |
        +--> Parse/Normalize Worker
        |        |
        |        v
        |   Classification + Extraction Worker (rules + LLM)
        |        |
        |        v
        |   Decision Worker (tasks, alerts, competition state)
        |
        +--> Reminder/Escalation Worker (delayed jobs)

Dashboard UI
- Triage
- Action queue
- Win center
- Competition lifecycle
- Feedback loop
```

## Message Taxonomy

Required classification labels:

- `acknowledgement`
- `confirm_required`
- `new_competition`
- `newsletter`
- `win_notification`
- `irrelevant`

## Data Model (V1)

### Account and Ingestion

- `gmail_accounts`
  - OAuth credentials (encrypted), token expiry, watch status, `history_id_last`.
- `email_messages_raw`
  - Immutable Gmail payload store, keyed by Gmail message ID per account.
- `email_messages`
  - Normalized sender/subject/body/received timestamps.
- `email_links`
  - Extracted links with domain and link type flags.

### Intelligence Outputs

- `email_classifications`
  - Label, confidence, model version, rule hits, review flag.
- `email_entities`
  - Competition/brand, links, prize summary, deadlines/claim dates.

### Competition Operations

- `competitions`
  - Canonical competition entity and lifecycle status.
- `competition_entries`
  - Entry/confirmation status and evidence.
- `tasks`
  - Human or automated work queue by urgency.
- `alerts`
  - Notification sends, acknowledgements, escalation level.
- `audit_events`
  - Immutable event log for all material changes.

## Workflow Design

### 1) Ingestion

- Use Gmail watch notifications when available.
- Run incremental sync via `users.history.list` using `history_id_last`.
- Fetch newly observed messages and store raw payloads.
- Enqueue parse jobs.

### 2) Parse/Normalize

- Decode MIME parts (`text/plain` + sanitized HTML).
- Extract URLs, sender domains, and metadata.
- Persist normalized records.
- Enqueue classification jobs.

### 3) Classify/Extract

- Execute deterministic rules first.
- Execute LLM extraction with strict JSON schema.
- Merge and score outputs.
- Mark `needs_review` when confidence is low.
- Enqueue decision jobs.

### 4) Decide/Act

- `win_notification` => immediate P1 task + alert.
- `confirm_required` => urgent task + reminders before deadline.
- `new_competition` => create/update competition + entry task.
- Unknown/low confidence => manual review queue.

### 5) Remind/Escalate

- Delayed jobs at T-24h/T-6h/T-1h.
- Escalation channels if unacknowledged.

## Gmail Integration Requirements

- Start with least privilege scopes (`gmail.readonly`, add `gmail.modify` only if auto-labeling is needed).
- Persist `history_id_last` atomically only after successful processing.
- Add periodic consistency sync window to recover missed notifications.
- Implement robust token refresh and account reauth flow.

## LLM Contract

Return strict JSON only with fields:

- `label`
- `confidence`
- `competition_name`
- `brand_name`
- `entry_url`
- `confirm_url`
- `terms_url`
- `prize_summary`
- `deadline_at`
- `claim_by_at`
- `reasoning_short`

Guardrails:

- `confidence < 0.70` => review required.
- Win classification should require strong linguistic evidence and/or claim instructions.
- Never auto-click unknown domains based solely on model output.

## API Surface (V1)

- Auth/Account
  - `POST /api/auth/google/start`
  - `GET /api/auth/google/callback`
  - `POST /api/accounts/:id/reauth`
- Sync
  - `POST /api/sync/gmail/:accountId/run`
  - `POST /api/sync/gmail/:accountId/watch/renew`
- Inbox
  - `GET /api/emails`
  - `GET /api/emails/:id`
  - `POST /api/emails/:id/reclassify`
  - `POST /api/emails/:id/feedback`
- Competition/Tasks
  - `GET /api/competitions`
  - `POST /api/competitions/:id/mark-entered`
  - `POST /api/competitions/:id/mark-confirmed`
  - `GET /api/tasks`
  - `POST /api/tasks/:id/complete`
- Alerts
  - `GET /api/alerts`
  - `POST /api/alerts/test`

## Security and Compliance

- Encrypt OAuth tokens at rest.
- Redact PII in logs.
- Maintain audit trail for all classification and action events.
- Add phishing/risk checks for win-like emails (sender/URL mismatch, suspicious language, unsafe attachments).
- Respect terms and site constraints before any auto-entry behavior.

## Observability

Track and alert on:

- Ingestion lag
- Parse success/failure rate
- Classification confidence distribution
- Manual correction rate
- Win alert latency
- Queue depth/retry/dead-letter metrics

## Phased Delivery

### Phase 1 (MVP)

- Gmail OAuth + incremental sync
- Raw + normalized storage
- Classification/extraction + triage UI
- Win candidate alerts

### Phase 2

- Task orchestration and escalation reminders
- Feedback loop and model/rule calibration

### Phase 3

- Trusted-site assisted entry (human-in-the-loop)

### Phase 4

- Controlled auto-entry on allowlisted sites with evidence capture and kill switch

## Definition of Done (MVP)

- Competition emails surface in dashboard within 2 minutes.
- Confirmation-required emails produce tasks reliably.
- Potential wins trigger immediate alerts.
- Duplicate Gmail events do not produce duplicate actions.
- Every action is traceable to source message(s) in audit log.
