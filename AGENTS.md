# Agent Guide

This file is the contract for any AI agent working in this repository. Read it before touching code. Apply every rule. The user has been burned by agents that didn't.

## The five rules

1. **Read before you write.** Before editing any component, read every file whose API it touches. No exceptions.
2. **Never invent.** If a method, type, or prop isn't in the file you just read, it doesn't exist. Do not guess. Ask the user.
3. **Verify, don't narrate.** After every tool call, look at the actual output. If the result is ambiguous, paste it back and ask. Do not write "clean compile, committed" without `tsc` output and `git log -1` confirming it.
4. **One file per turn.** Migrations, refactors, big rewrites — one file at a time, with `tsc` between each. Big batches hide errors.
5. **Single-line commits.** `git commit -m "message"` on one line, no `\n`, no multiple `-m` flags. Windows cmd.exe will word-split anything else into pathspecs and the commit will silently fail.

## Authoritative file map

The real APIs live in these files. Do not rely on memory.

- **Store**: `src/stores/useAppStore.ts` (425 lines, single hook returning a flat object)
- **Store type**: `src/stores/storeContract.ts` — `Store = ReturnType<typeof useAppStore>`
- **Types**: `src/types/index.ts` (234 lines)
- **Settings type**: `AppSettings` in `src/types/index.ts`. Fields: `approvals`, `approvalDefaultsVersion`, `fontSize`, `sendOnEnter`, `workdir`, `notifyOnDone`, `notifyOnApproval`, `nickname`, `instructions`, `memories`, `defaultModel`, `compactMode`, `theme`, `sounds`, `mcpServers`. **No** `mergeMode`, `webSearchEnabled`, `welcomeSeen`, `userInstructions`, `density`, `accentColor`.

## Verified store methods (as of 2026-06-05)

```
workspaces, conversations, settings, activeWorkspaceId, activeConversationId
activeWorkspace, activeConversation, workspaceConversations, trashedConversations, archivedConversations
notifications
setActiveWorkspaceId, setActiveConversationId
createConversation, softDeleteConversation, restoreConversation, permanentDeleteConversation
archiveConversation, unarchiveConversation, duplicateConversation
updateConversation, addMessage, updateMessage, updateMessageWith, deleteMessage
setAgentStatus, addActivity
enqueueMessage, dequeueMessage, updateQueuedMessage, deleteQueuedMessage, reorderQueue, clearQueue
createWorkspace, updateWorkspace, deleteWorkspace, reorderWorkspaces
updateSettings, togglePin, toggleFavorite
addMemory, updateMemory, deleteMemory, toggleMemory
exportConversation, importConversation, saveDraft
pushNotification, markNotificationRead, clearNotifications
updateMcpServers
```

If you need a method not on this list: it does not exist. Either compose existing methods, or ask the user before adding one.

## Critical type pitfalls

- `ToolCallRecord.name` (NOT `tool`), `startedAt`, `finishedAt` (NOT `endedAt`, NOT `durationMs`), `args` is `Record<string, string>`
- `ToolCallRecord.status`: `"pending" | "running" | "complete" | "error" | "denied"` — NOT `"done"`
- `Workspace.icon` is a string. It may be a legacy emoji or a key. Use `getWorkspaceIcon()` from `src/lib/workspaceIcons.tsx`.
- `Attachment` has `path?`, `mimeType`, `isBinary`, `content`. NOT `url`.
- `ApprovalRequest`: `id`, `convId`, `toolName`, `raw`, `title`, `detail?`, `risk`, `createdAt`. NOT `summary`, NOT `command`.
- `dequeueMessage(convId)` takes ONE arg and returns the dequeued message or null.
- `addActivity(convId, event)` — event omits `id` and `timestamp`.
- `pushNotification(n)` — `n` omits `id` and `timestamp`.

## Tool-format rules (the runtime will bite you)

Each parameter on its own line. The runtime parses `key: value` per line; anything on one line with two `key:` segments will be mangled.

CORRECT (parameters on separate lines):

```
[TOOL: write-file]
path: foo.ts
content: hello