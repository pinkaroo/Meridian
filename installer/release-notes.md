## Meridian v1.0.7

### New

- **Chat vs Agent modes.** The sidebar now has Agent and Chat tabs. Agent mode is the full pair-programming experience with workspaces, approvals, and tool access. Chat mode is a lighter conversational setup with no workspaces - tools are still available when you explicitly ask for things like PDFs, documents, or code execution, but they stay out of the way during normal conversation. A conversation's mode is fixed when you create it.
- **Cloudflare Worker proxy.** All upstream API routing now lives in a Cloudflare Worker (text, vision, and fallback all behind one endpoint). The desktop app no longer carries any API keys or upstream URLs. Endpoint changes and key rotations happen server-side from this point forward - no rebuild needed.
- **Bulk conversation editing.** Multi-select mode in the sidebar with bulk delete, rename (with `{n}` and `{title}` placeholders and live preview), pin, and archive. Plus an empty-trash button.
- **AI-generated conversation titles.** Fresh conversations get a real title shortly after the first message, replacing the provisional truncated one.
- **Global search (Ctrl+Shift+F).** Fuzzy match across every conversation's title and message content, jump-to-message on Enter.
- **In-conversation search (Ctrl+F).** Match counting, next/prev navigation, scroll-to-match. Works everywhere except when the chat input has focus.
- **Branch from message.** Hover any message, click the branch icon - forks the conversation at that point into a new branch with the prefix copied.
- **Quote message.** Hover any message, click quote - appends a markdown blockquote to the chat input and focuses it.
- **Diff view for write tools.** `edit-file`, `write-file`, `replace-all-in-file`, and `append-file` tool cards now show a real unified diff in the expanded body instead of raw before/after blobs.
- **Approval rule manager.** Settings now has a full UI for listing, editing, reordering, and deleting per-command approval rules.

### Improvements

- **Anti-mojibake at the write boundary.** Every file write goes through a sanitizer that repairs double-encoded UTF-8 and folds typographic characters (curly quotes, em dashes, ellipses, NBSP, arrows) to plain ASCII before hitting disk. Files that already contain non-ASCII content are preserved.
- **Per-conversation context memory.** Switching between Agent and Chat tabs remembers which conversation you had open in each mode and restores it. The selected tab is persisted across app restarts.
- **Auto-create on send.** Sending a message with no active conversation now creates one in the current mode and workspace, then sends - one action instead of two.
- **Concurrent subagent cap.** Hard limit of 10 simultaneous subagents with the rest queued cleanly.
- **System prompt rewrite.** Tighter voice rules - length matches the question, prose by default, fewer bullet lists for short answers, no greeting filler, proper capitalization, no engagement-baiting closers, explicit anti-hallucination guards.

### Fixes

- Conversation lists no longer mix Agent and Chat modes; bulk operations only touch the visible filtered list.
- Auto-scroll now engages from the first message in a fresh conversation instead of waiting for a manual scroll to the bottom.
- The send-after-create flow now actually sends instead of just creating an empty conversation.
- Streaming caret no longer lingers on a previous message when a queued one fires.
- Console no longer spams missing-file errors for optional `settings.json` files in skills that don't have one.