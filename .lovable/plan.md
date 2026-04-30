## Plan: Export full chat transcript to `docs/CHAT_TRANSCRIPT.md`

### What I'll do

1. Use `chat_search--read_chat_messages` in sequential 20-message windows (the tool's max range) starting from index 1, walking forward until the history is exhausted.
2. For each message, capture:
   - Index + timestamp
   - Role (User / Assistant)
   - Verbatim content
3. Assemble into a single Markdown document with this structure:
   ```
   # Kuso Oishii — Build Chat Transcript
   Generated: <date>
   Total messages: <N>

   ---
   ## Message 1 — User — <timestamp>
   <verbatim body>

   ## Message 2 — Assistant — <timestamp>
   <verbatim body>
   ...
   ```
4. Write the final file to `docs/CHAT_TRANSCRIPT.md` via `code--write`.

### Notes / caveats

- **Size**: This project has a very long history (hundreds of messages, many large). The resulting `.md` file will likely be several MB. That's fine for a repo doc but it will be large in git diffs.
- **Truncation**: The chat history tools return previews, not always full message bodies. If `read_chat_messages` truncates very long assistant messages, the transcript will reflect what the tool returns (I'll note this at the top of the file). Verbatim user messages should come through in full.
- **Tool-use blocks**: Past assistant messages contain `lov-tool-use` / file-edit blocks. I'll keep them inline so the transcript reflects the real exchange.
- **No code/app changes**: This is a documentation export only — no source files, migrations, or edge functions are touched.
- **One file, no chunking**: Single `docs/CHAT_TRANSCRIPT.md`. If the file becomes unwieldy I can split into `CHAT_TRANSCRIPT_part1.md`, etc., but default is one file.

### Deliverable

- `docs/CHAT_TRANSCRIPT.md` committed to the repo.

Approve and I'll run the extraction and write the file.