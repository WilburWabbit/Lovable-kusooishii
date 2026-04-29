# Verbatim Lovable Chat Transcript

This directory contains a chunked, verbatim export of the Lovable agent chat history for the Kuso Oishii project. It exists as a long-term reference for decisions, prompts, and reasoning that produced the codebase.

## Why this is a manual / agent-driven workflow

The Lovable chat history lives in Lovable's chat backend. It is **not** stored in this project's Supabase database and there is no public API endpoint or token that an edge function or `pg_cron` job can call to fetch it. As a result:

- A scheduled Supabase edge function **cannot** export this transcript automatically.
- The export is performed by the Lovable agent (me) during a chat session, using the internal `chat_search--read_chat_messages` tool.
- The user triggers it by asking for the next chunk.

If Lovable later exposes a chat-export API to the account, this can be replaced with a GitHub Action or external cron. Until then, treat this as a recurring agent task.

## File naming

```
PART_<NN>_msgs_<from>-<to>.md
```

- `NN` — zero-padded part number (02, 03, …).
- `from` / `to` — 1-based message indices in the full chat history at the time of export.

Existing parts:

- `PART_02_msgs_197-256.md`
- `PART_03_msgs_257-450.md`
- `PART_04_msgs_451-650.md`
- `PART_05_msgs_651-850.md`
- `PART_06_msgs_651-850.md` *(see actual file)*
- `PART_07_msgs_1051-1250.md`
- `PART_08_msgs_1251-1450.md`
- `PART_09_msgs_1451-1650.md`
- `PART_10_msgs_1651-1910.md`

Chunks are roughly 200 messages, but size is adjusted to land on natural conversation boundaries.

## How to resume the export (instructions for the next agent)

When the user says **"next chunk"**, **"continue with part N"**, or any equivalent:

1. Identify the highest existing `PART_NN_msgs_<from>-<to>.md` file in this directory.
2. The next part starts at `to + 1`.
3. Use `chat_search--read_chat_messages` in 20-message windows to fetch up to ~200 messages of new history. Stop early if you hit the end of the conversation.
4. Write the new file as `docs/transcript/PART_<NN+1>_msgs_<from>-<new_to>.md`.
   - Preserve **verbatim** message content where possible.
   - Where messages are extremely long (large code dumps, tool result blobs), it is acceptable to summarise tool results but keep all user messages and the assistant's natural-language responses verbatim.
   - Always include the message index and role (`user` / `assistant`) for each entry.
5. After writing, reply to the user with:
   - The new file path.
   - A short summary of the key technical points covered in that range.
   - The phrase `Say "next chunk" for Part <NN+2>.`

## What to capture per message

Each message block in a part file should look like:

```
### Message <index> — <role>
<timestamp if available>

<verbatim content>
```

For assistant messages that contain tool calls, list the tool names invoked and a one-line description of what each call did, then include the assistant's final natural-language reply verbatim.

## What NOT to do

- Do **not** create a Supabase edge function or `pg_cron` job for this. It cannot access the chat history and would only ever write empty/placeholder files.
- Do **not** rewrite or "improve" earlier parts. They are a historical record.
- Do **not** skip messages to make a chunk shorter — chunk on indices, not on content.
- Do **not** include secrets, tokens, or full API keys that may have appeared in earlier messages. Redact with `[REDACTED]` if encountered.
