

## Update QBO Webhook Verifier Token

This is a simple secret update — no code or database changes needed.

### What will happen

1. Use the `add_secret` tool to prompt you to enter the new `QBO_WEBHOOK_VERIFIER` value
2. The updated secret will be immediately available to the `qbo-webhook` edge function, which uses it for HMAC-SHA256 signature verification of incoming QBO notifications

No file edits or migrations required.

