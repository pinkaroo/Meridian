import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { buildSystemPrompt, buildChatSystemPrompt } from "./systemPrompt";
import { buildMcpToolsPrompt, mcpCallTool, mcpToolResultToText } from "./mcp";
import { loadSkills, resolveSkillRoots, type SkillEntry } from "./skills";
import { loadSkillSchema, getDecryptedSkillSettings } from "./skillSettings";
import { isUnlocked as isSkillVaultUnlocked } from "./skillCrypto";
import { StreamParser } from "./streamParser";
import { sanitizeForPrompt } from "./sanitizeForPrompt";
import { sanitizeForWrite, hasNonAscii } from "./antiMojibake";
import { recordFileRead, checkFileChanged } from "./fileTracking";
import type {
  AppSettings,
  Attachment,
  Conversation,
  Message,
  MessageSegment,
  ToolCallRecord,
  Workspace,
  AgentStatus,
  ActivityEvent,
  McpServer,
  FileSnapshot,
  CommandRule,
} from "../types";

export interface ApprovalRequestInput {
  toolName: string;
  title: string;
  detail?: string;
  raw: string;
  risk: "low" | "medium" | "high";
}

export interface AgentCallbacks {
  onStatusChange: (status: AgentStatus) => void;
  onMessageCreate: (msg: Message) => void;
  onMessageUpdate: (msgId: string, updater: (msg: Message) => Partial<Message>) => void;
  onActivity: (ev: Omit<ActivityEvent, "id" | "timestamp">) => void;
  onMemoryAdded: (content: string) => string;
  onApprovalRequired: (req: ApprovalRequestInput) => Promise<"approved" | "denied">;
onError: (err: string) => void;
  onDone: () => void;
  onConsumeQueued?: () => { content: string; attachments?: Attachment[] } | null | undefined;
  onConvFileAdded?: (file: { name: string; path: string; mimeType: string; size: number; content: string; isBinary: boolean }) => void;
  onConvFileRead?: (name: string) => { content: string; mimeType: string; isBinary: boolean } | null;
  onConvFileUpdate?: (name: string, content: string) => boolean;
  onConvFileDelete?: (name: string) => boolean;
  onConvFileRename?: (oldName: string, newName: string) => boolean;
  onConvFileList?: () => Array<{ name: string; size: number; mimeType: string; source: string }>;
}

export interface RunAgentOptions {
  continueMessageId?: string;
  continuePriorText?: string;
  suppressUserMessage?: boolean;
}

const RUNAWAY_SAFETY_LIMIT = 1000;

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\.env(\.|$)/i,
  /secrets?\./i,
  /credentials?\./i,
  /id_rsa/i,
  /\.pem$/i,
  /\.key$/i,
];

const WRITE_TOOLS = new Set([
  "write-file", "edit-file", "append-file", "delete-file",
  "move-file", "copy-file", "create-directory",
]);

const READ_TOOLS = new Set([
  "read-file", "read-file-range", "file-info", "file-exists",
  "list-directory", "search-files",
]);

export const MAX_TEXT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

interface StepBackup {
  checkpointId: string;
  stepNumber: number;
  messageId: string;
  workingDir: string;
  snapshots: Map<string, string | null>;
}

const BACKUP_STORE: StepBackup[] = [];
const MAX_BACKUP_STEPS = 500;

function findOrCreateStepBackup(
  messageId: string,
  stepNumber: number,
  checkpointId: string,
  workingDir: string,
): StepBackup {
  let existing = BACKUP_STORE.find(
    s => s.messageId === messageId && s.stepNumber === stepNumber,
  );
  if (existing) return existing;
  existing = { checkpointId, stepNumber, messageId, workingDir, snapshots: new Map() };
  BACKUP_STORE.push(existing);
  if (BACKUP_STORE.length > MAX_BACKUP_STEPS) BACKUP_STORE.shift();
  return existing;
}

async function snapshotPathIfNeeded(step: StepBackup, path: string): Promise<void> {
  if (!path) return;
  if (step.snapshots.has(path)) return;
  try {
    const content = await invoke<string>("tool_read_file", { path, baseDir: step.workingDir || undefined });
    step.snapshots.set(path, content);
  } catch {
    step.snapshots.set(path, null);
  }
}

export async function restoreToCheckpoint(
  messageId: string,
  checkpointId: string,
): Promise<{ restored: string[]; errors: string[] }> {
  const stepsInMessage = BACKUP_STORE.filter(s => s.messageId === messageId);
  const targetIdx = stepsInMessage.findIndex(s => s.checkpointId === checkpointId);
  if (targetIdx === -1) return { restored: [], errors: ["Checkpoint not found"] };
  const relevant = stepsInMessage.slice(targetIdx);
  const earliest = new Map<string, string | null>();
  for (const step of relevant) {
    for (const [path, content] of step.snapshots.entries()) {
      if (!earliest.has(path)) earliest.set(path, content);
    }
  }
  const restored: string[] = [];
  const errors: string[] = [];
  const workingDir = relevant[0]?.workingDir || "";
  for (const [path, original] of earliest.entries()) {
    try {
      if (original === null) {
        try { await invoke<string>("tool_delete_file", { path, baseDir: workingDir || undefined }); } catch { }
      } else {
        await invoke<string>("tool_write_file", { path, content: original, baseDir: workingDir || undefined });
      }
      restored.push(path);
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (let i = BACKUP_STORE.length - 1; i >= 0; i--) {
    const s = BACKUP_STORE[i];
    if (s.messageId === messageId && stepsInMessage.indexOf(s) >= targetIdx) {
      BACKUP_STORE.splice(i, 1);
    }
  }
  return { restored, errors };
}

export function clearBackupsForMessage(messageId: string): void {
  for (let i = BACKUP_STORE.length - 1; i >= 0; i--) {
    if (BACKUP_STORE[i].messageId === messageId) BACKUP_STORE.splice(i, 1);
  }
}

function uid(prefix = "id"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return prefix + "-" + crypto.randomUUID();
  }
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

export async function runAgent(
  conv: Conversation,
  text: string,
  settings: AppSettings,
  signal: AbortSignal,
  cb: AgentCallbacks,
  workspace?: Workspace,
  attachments?: Attachment[],
  options?: RunAgentOptions,
  mcpServers?: McpServer[],
): Promise<void> {
  try {
    const isContinuation = !!options?.continueMessageId;

    if (!isContinuation && !options?.suppressUserMessage) {
      const userMsg: Message = {
        id: uid("msg"),
        role: "user",
        content: text,
        timestamp: Date.now(),
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      };
      cb.onMessageCreate(userMsg);
    }

    const history: { role: "user" | "assistant"; content: string }[] = conv.messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    if (isContinuation) {
      if (options?.continuePriorText) {
        history.push({ role: "assistant", content: options.continuePriorText });
      }
      history.push({ role: "user", content: text });
    } else {
      history.push({ role: "user", content: renderUserTurn(text, attachments) });
    }

const model = conv.model || settings.defaultModel;
    const workingDir = workspace?.workingDirectory?.trim() || settings.workdir?.trim() || "";

let skills: SkillEntry[] = [];
    let skillConfiguredKeys: Record<string, string[]> = {};
    try {
      const roots = resolveSkillRoots(workingDir, settings.skillsGlobalRoot);
      if (roots.length) skills = await loadSkills(roots);
      try {
        const { loadSkillSchema, getRawSkillSettings } = await import("./skillSettings");
        for (const s of skills) {
          const schema = await loadSkillSchema(s.relPath);
          if (!schema) continue;
          const raw = getRawSkillSettings(s.name);
          const keys: string[] = [];
          for (const f of schema.fields) {
            if (raw[f.key] !== undefined && raw[f.key] !== null && raw[f.key] !== "") {
              keys.push(f.key);
            }
          }
          if (keys.length) skillConfiguredKeys[s.name] = keys;
        }
      } catch {
      }
    } catch (err) {
      cb.onActivity({
        type: "message",
        label: "Failed to load skills",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    let assistantMsgId: string;
    if (isContinuation && options?.continueMessageId) {
      assistantMsgId = options.continueMessageId;
      cb.onMessageUpdate(assistantMsgId, () => ({ streaming: true }));
    } else {
      const assistantMsg: Message = {
        id: uid("msg"),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
        segments: [],
        model,
      };
      assistantMsgId = assistantMsg.id;
      cb.onMessageCreate(assistantMsg);
    }

    let iter = 0;
    let aggregateText = "";

    while (iter < RUNAWAY_SAFETY_LIMIT) {
      iter += 1;
      if (signal.aborted) break;

const isChatMode = conv.mode === "chat";
      const allImages = collectImageAttachments(conv, attachments);
      const mcpSection = mcpServers ? buildMcpToolsPrompt(mcpServers) : "";
      const systemPrompt = isChatMode
        ? buildChatSystemPrompt(settings, conv, allImages, model)
        : buildSystemPrompt(settings, conv, workspace, allImages, model, skills, skillConfiguredKeys) + mcpSection;
      const titleInstruction = "";
      const responseInstruction = "\n\nAfter completing work, give a concise user-facing summary of what changed, files affected, and any checks or next steps. Keep internal tool syntax and raw protocol markers out of that summary.";

      const turnImages = iter === 1 ? allImages : [];
      if (turnImages.length > 0) {
        cb.onActivity({
          type: "message",
          label: "Switched to gpt-5.6",
          detail: `Image attachment detected (${turnImages.length} image${turnImages.length === 1 ? "" : "s"}) â€” routing to vision model.`,
        });
      }
      const { fullText, toolCalls } = await streamOneTurn({
        systemPrompt: systemPrompt + responseInstruction,
        messages: history,
        model,
        signal,
        assistantMsgId,
        cb,
        images: turnImages,
      });

      aggregateText += (aggregateText ? "\n\n" : "") + fullText;
      cb.onMessageUpdate(assistantMsgId, () => ({ content: aggregateText }));

      if (signal.aborted) break;

history.push({ role: "assistant", content: fullText });

      const effectiveToolCalls = toolCalls;

      if (effectiveToolCalls.length === 0) {
        const queued = cb.onConsumeQueued?.();
if (queued && queued.content) {
          cb.onMessageUpdate(assistantMsgId, () => ({ streaming: false, content: aggregateText }));

          cb.onMessageCreate({
            id: uid("msg"),
            role: "user",
            content: queued.content,
            timestamp: Date.now(),
            attachments: queued.attachments && queued.attachments.length > 0 ? queued.attachments : undefined,
          });
          const nextAssistantMsg: Message = {
            id: uid("msg"),
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            streaming: true,
            segments: [],
            model,
          };
          assistantMsgId = nextAssistantMsg.id;
          cb.onMessageCreate(nextAssistantMsg);
          aggregateText = "";
          history.push({ role: "user", content: renderUserTurn(queued.content, queued.attachments) });
          continue;
        }
        break;
      }

      const checkpointId = uid("ckpt");
      const stepBackup = findOrCreateStepBackup(assistantMsgId, iter, checkpointId, workingDir);
      const filesTouchedThisStep = new Set<string>();
      const toolOutputs: string[] = [];

      let stoppedEarly = false;
      let stopReason = "";

      for (let i = 0; i < effectiveToolCalls.length; i++) {
        if (signal.aborted) break;
        const tc = effectiveToolCalls[i];

        if (tc.name === "wait-for-results") {
          updateToolStatus(cb, assistantMsgId, tc.id, {
            status: "complete",
            result: "Pausing batch. Subsequent calls deferred to next turn.",
            finishedAt: Date.now(),
          });
          toolOutputs.push(
            `[TOOL: wait-for-results]\nInput: ${JSON.stringify(tc.args)}\nOutput:\nSentinel reached. Subsequent tool calls in this message were deferred.`,
          );
          if (i < effectiveToolCalls.length - 1) {
            const deferredCount = effectiveToolCalls.length - 1 - i;
            stoppedEarly = true;
            stopReason = `wait-for-results: ${deferredCount} subsequent tool call(s) were DEFERRED and did NOT run. Re-issue them in your next response with refined args based on the results above.`;
            for (let j = i + 1; j < effectiveToolCalls.length; j++) {
              const deferredTc = effectiveToolCalls[j];
              updateToolStatus(cb, assistantMsgId, deferredTc.id, {
                status: "denied",
                result: "Deferred by wait-for-results â€” not executed. Re-issue next turn.",
                finishedAt: Date.now(),
              });
              toolOutputs.push(
                `[TOOL: ${deferredTc.name}]\nInput: ${JSON.stringify(deferredTc.args)}\nOutput:\nDEFERRED â€” this tool was NOT executed because a wait-for-results sentinel appeared before it. Re-issue it in your next response with refined arguments based on the results above.`,
              );
            }
          }
          break;
        }

        if (WRITE_TOOLS.has(tc.name)) {
          const paths = extractPaths(tc.args);
          for (const p of paths) {
            await snapshotPathIfNeeded(stepBackup, p);
            filesTouchedThisStep.add(p);
          }
        }

        const outcome = await runToolCall({
          assistantMsgId,
          toolCall: tc,
          settings,
          workingDir,
          cb,
          signal,
          mcpServers,
        });

        toolOutputs.push(
          `[TOOL: ${tc.name}]\nInput: ${JSON.stringify(tc.args)}\nOutput:\n${outcome.text}`,
        );

        if (!outcome.ok) {
          if (i < effectiveToolCalls.length - 1) {
            stoppedEarly = true;
            const remaining = toolCalls.length - 1 - i;
            stopReason = `Batch halted after error in ${tc.name}. ${remaining} subsequent tool call(s) skipped â€” re-issue them after addressing the failure.`;
          }
          break;
        }
      }

      if (signal.aborted) break;

      if (filesTouchedThisStep.size > 0) {
        const filesArr = Array.from(filesTouchedThisStep);
        cb.onMessageUpdate(assistantMsgId, (m): Partial<Message> => {
          const segs: MessageSegment[] = [...(m.segments ?? [])];
          segs.push({ kind: "checkpoint", checkpointId, stepNumber: iter, filesTouched: filesArr });
          return { segments: segs };
        });
      }

      const trailer = stoppedEarly && stopReason ? `\n\n[BATCH NOTE]\n${stopReason}` : "";

      history.push({
        role: "user",
        content: `<tool_results>\n${toolOutputs.join("\n\n")}${trailer}\n</tool_results>`,
      });

      const queuedMid = cb.onConsumeQueued?.();
      if (queuedMid && queuedMid.content) {
        cb.onMessageUpdate(assistantMsgId, () => ({ streaming: false, content: aggregateText }));

        cb.onMessageCreate({
          id: uid("msg"),
          role: "user",
          content: queuedMid.content,
          timestamp: Date.now(),
          attachments: queuedMid.attachments && queuedMid.attachments.length > 0 ? queuedMid.attachments : undefined,
        });

        const nextAssistantMsg: Message = {
          id: uid("msg"),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          streaming: true,
          segments: [],
          model,
        };
        assistantMsgId = nextAssistantMsg.id;
        cb.onMessageCreate(nextAssistantMsg);
        aggregateText = "";

        history.push({ role: "user", content: renderUserTurn(queuedMid.content, queuedMid.attachments) });
      }
    }

    cb.onMessageUpdate(assistantMsgId, () => ({ streaming: false, content: aggregateText }));

    if (iter >= RUNAWAY_SAFETY_LIMIT) {
      cb.onActivity({ type: "message", label: `Runaway guard tripped at ${RUNAWAY_SAFETY_LIMIT} iterations` });
    }

    cb.onDone();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (signal.aborted) {
      cb.onDone();
    } else {
      cb.onError(msg);
    }
  }
}

interface StreamTurnArgs {
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  model: string;
  signal: AbortSignal;
  assistantMsgId: string;
  cb: AgentCallbacks;
  images?: Attachment[];
}

interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, string>;
}

async function streamOneTurn(args: StreamTurnArgs): Promise<{ fullText: string; toolCalls: ParsedToolCall[] }> {
  const MAX_RETRIES = 3;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (args.signal.aborted) break;
    if (attempt > 0) {
      if (args.signal.aborted) break;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      args.cb.onActivity({
        type: "message",
        label: `Network error â€” retrying (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
        detail: lastErr?.message,
      });
      await new Promise(r => setTimeout(r, delay));
      if (args.signal.aborted) break;
    }
    try {
      return await attemptStreamOneTurn(args);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const isTransient = (
        lastErr.message.includes("Request failed") ||
        lastErr.message.includes("Stream error") ||
        lastErr.message.includes("Server error 5")
      );
      if (!isTransient || attempt === MAX_RETRIES) throw lastErr;
    }
  }

  throw lastErr ?? new Error("Stream aborted");
}

async function attemptStreamOneTurn(args: StreamTurnArgs): Promise<{ fullText: string; toolCalls: ParsedToolCall[] }> {
  const { systemPrompt, messages, model, signal, assistantMsgId, cb, images } = args;

  const requestId = uid("req");
  const parser = new StreamParser();
  let fullText = "";
  const toolCalls: ParsedToolCall[] = [];

  let unlistenChunk: UnlistenFn | null = null;
  let unlistenDone: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let cancelled = false;

  let resolveDone: ((v: void) => void) | null = null;
  let rejectDone: ((e: Error) => void) | null = null;
  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  function applyEvents(events: ReturnType<StreamParser["feed"]>) {
    if (events.length === 0) return;

    let textDelta = "";

    for (const ev of events) {
      if (ev.type === "text") textDelta += stripWaitSentinels(ev.text);
      if (ev.type === "tool_end") {
        const args = { ...ev.attrs, ...(ev.body ? { body: ev.body } : {}) };
        toolCalls.push({ id: ev.id, name: ev.name, args });
      }
    }

    cb.onMessageUpdate(assistantMsgId, (m): Partial<Message> => {
      const segs: MessageSegment[] = [...(m.segments ?? [])];

for (const ev of events) {
        switch (ev.type) {
          case "text": {
            const last = segs[segs.length - 1];
            if (last && last.kind === "text") {
              segs[segs.length - 1] = { kind: "text", text: last.text + stripWaitSentinels(ev.text), sourceId: last.sourceId };
            } else {
              segs.push({ kind: "text", text: stripWaitSentinels(ev.text) });
            }
            break;
          }
          case "thinking_start": {
            segs.push({ kind: "thinking", text: "", sourceId: ev.id });
            cb.onActivity({ type: "thinking", label: "Thinking" });
            break;
          }
          case "thinking_delta": {
            const idx = segs.findIndex(s => s.kind === "thinking" && s.sourceId === ev.id);
            if (idx >= 0) {
              const s = segs[idx];
              if (s.kind === "thinking") {
                segs[idx] = { kind: "thinking", text: s.text + ev.text, sourceId: s.sourceId, collapsed: s.collapsed };
              }
            }
            break;
          }
          case "thinking_end":
            break;
          case "tool_start": {
            const call: ToolCallRecord = {
              id: ev.id,
              name: ev.name,
              args: { ...ev.attrs },
              status: "pending",
              startedAt: Date.now(),
            };
            segs.push({ kind: "tool", call });
            cb.onActivity({ type: "tool_use", label: ev.name });
            break;
          }
          case "tool_body_delta": {
            let idx = -1;
            const last = segs[segs.length - 1];
            if (last && last.kind === "tool" && last.call.id === ev.id) {
              idx = segs.length - 1;
            } else {
              idx = findToolSegment(segs, ev.id);
            }
            if (idx >= 0) {
              const s = segs[idx];
              if (s.kind === "tool") {
                const toolArgs = { ...s.call.args, body: (s.call.args.body ?? "") + ev.text };
                segs[idx] = { kind: "tool", call: { ...s.call, args: toolArgs } };
              }
            }
            break;
          }
          case "tool_end": {
            let idx = -1;
            const last = segs[segs.length - 1];
            if (last && last.kind === "tool" && last.call.id === ev.id) {
              idx = segs.length - 1;
            } else {
              idx = findToolSegment(segs, ev.id);
            }
            if (idx >= 0) {
              const s = segs[idx];
              if (s.kind === "tool") {
                const finalArgs = { ...ev.attrs, ...(ev.body ? { body: ev.body } : {}) };
                segs[idx] = { kind: "tool", call: { ...s.call, args: finalArgs } };
              }
            }
            break;
          }
        }
      }
      return { segments: segs };
    });

    fullText += textDelta;
  }

  const onAbort = () => {
    if (cancelled) return;
    cancelled = true;
    resolveDone?.();
  };

  try {
    unlistenChunk = await listen<{ requestId: string; delta: string }>("chat-chunk", e => {
      if (cancelled || e.payload.requestId !== requestId) return;
      applyEvents(parser.feed(e.payload.delta));
    });

    unlistenDone = await listen<{ requestId: string }>("chat-done", e => {
      if (cancelled || e.payload.requestId !== requestId) return;
      applyEvents(parser.end());
      resolveDone?.();
    });

    unlistenError = await listen<{ requestId: string; error: string }>("chat-error", e => {
      if (cancelled || e.payload.requestId !== requestId) return;
      rejectDone?.(new Error(e.payload.error));
    });

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const fullMessage = systemPrompt + "\n\n" + renderHistoryBlock(messages);

const useVision = images && images.length > 0;
    if (useVision) {
const visionImages = images!.map(img => {
        let content = img.content || "";
        const m = content.match(/^data:[^;]+;base64,(.+)$/);
        if (m) content = m[1];
        return { mimeType: img.mimeType, content };
      });
      invoke("chat_stream_vision", { requestId, message: fullMessage, images: visionImages }).catch(err => {
        const m = err instanceof Error ? err.message : String(err);
        rejectDone?.(new Error(m));
      });
    } else {
      invoke("chat_stream", { requestId, message: fullMessage, model }).catch(err => {
        const m = err instanceof Error ? err.message : String(err);
        rejectDone?.(new Error(m));
      });
    }

    await donePromise;
  } finally {
    signal.removeEventListener("abort", onAbort);
    try { unlistenChunk?.(); } catch { }
    try { unlistenDone?.(); } catch { }
    try { unlistenError?.(); } catch { }
  }

  return { fullText, toolCalls };
}

interface RunToolArgs {
  assistantMsgId: string;
  toolCall: ParsedToolCall;
  settings: AppSettings;
  workingDir: string;
  cb: AgentCallbacks;
  signal: AbortSignal;
  mcpServers?: McpServer[];
}

interface ToolOutcome {
  text: string;
  ok: boolean;
}

async function runToolCall(args: RunToolArgs): Promise<ToolOutcome> {
  const { assistantMsgId, toolCall, settings, workingDir, cb, signal, mcpServers } = args;
  const { id: toolId, name, args: params } = toolCall;

  updateToolStatus(cb, assistantMsgId, toolId, { status: "running" });

  if (signal.aborted) return finishTool(cb, assistantMsgId, toolId, "", "Aborted", "denied");

  const targetPaths = extractPaths(params);
  const outsidePaths = workingDir ? targetPaths.filter(p => !isInsideDir(p, workingDir)) : [];

  if (outsidePaths.length > 0 && WRITE_TOOLS.has(name)) {
    cb.onStatusChange("waiting_approval");
    const decision = await cb.onApprovalRequired({
      toolName: name,
      title: `Allow ${name} outside working directory?`,
      detail: `Target path(s): ${outsidePaths.join(", ")}\nWorking dir: ${workingDir}`,
      raw: formatRaw(name, params),
      risk: "high",
    });
    cb.onStatusChange("working");
    if (decision === "denied") return finishTool(cb, assistantMsgId, toolId, "", "User denied write outside working directory.", "denied");
  }

  const approvalReason = whyApprovalNeeded(name, params, settings);
if (approvalReason) {
    if (name === "run-command") {
      const cmdText = (params.body ?? params.command ?? "").trim();
      const ruleDecision = matchCommandRule(cmdText, settings.commandRules ?? []);
      if (ruleDecision === "deny") {
        return finishTool(cb, assistantMsgId, toolId, "", `Blocked by command rule: ${cmdText}`, "denied");
      }
      if (ruleDecision === "approve") {
      } else {
        cb.onStatusChange("waiting_approval");
        const decision = await cb.onApprovalRequired({
          toolName: name,
          title: `Approve ${name}?`,
          detail: approvalReason,
          raw: formatRaw(name, params),
          risk: riskFor(name, params),
        });
        cb.onStatusChange("working");
        if (decision === "denied") return finishTool(cb, assistantMsgId, toolId, "", "User denied this action.", "denied");
      }
    } else {
      cb.onStatusChange("waiting_approval");
      const decision = await cb.onApprovalRequired({
        toolName: name,
        title: `Approve ${name}?`,
        detail: approvalReason,
        raw: formatRaw(name, params),
        risk: riskFor(name, params),
      });
      cb.onStatusChange("working");
      if (decision === "denied") return finishTool(cb, assistantMsgId, toolId, "", "User denied this action.", "denied");
    }
  }

  if (name === "memory-add") {
    const content = (params.body ?? params.content ?? "").trim();
    if (!content) return finishTool(cb, assistantMsgId, toolId, "", "memory-add requires content", "error");
    const id = cb.onMemoryAdded(content);
    return finishTool(cb, assistantMsgId, toolId, `Saved memory ${id}`, undefined, "complete");
  }

  if (name === "wait-for-results") {
    return finishTool(cb, assistantMsgId, toolId, "Acknowledged. Proceeding with next turn.", undefined, "complete");
  }

  const isConvPath = (p: string | undefined): p is string => typeof p === "string" && p.startsWith("conv:");
  const convFileName = (p: string) => p.slice(5);
  const guessConvMime = (fname: string): string => {
    const ext = fname.toLowerCase().split(".").pop() || "";
    const map: Record<string, string> = { txt: "text/plain", md: "text/markdown", json: "application/json", js: "text/javascript", ts: "text/typescript", tsx: "text/typescript", jsx: "text/javascript", py: "text/x-python", html: "text/html", css: "text/css", csv: "text/csv", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml", lua: "text/x-lua", rs: "text/x-rust", go: "text/x-go", sh: "text/x-shellscript", bat: "text/x-batch" };
    return map[ext] || "text/plain";
  };


  if (name === "rename-conv-file") {
    const oldName = params.from || params.old || params.name;
    const newName = params.to || params.new;
    if (!oldName || !newName) return finishTool(cb, assistantMsgId, toolId, "", "rename-conv-file requires 'from' and 'to'", "error");
    if (!cb.onConvFileRename) return finishTool(cb, assistantMsgId, toolId, "", "rename not available", "error");
    const ok = cb.onConvFileRename(oldName, newName);
    return finishTool(cb, assistantMsgId, toolId, ok ? `Renamed: ${oldName} -> ${newName}` : "", ok ? undefined : `conv file not found: ${oldName}`, ok ? "complete" : "error");
  }
  if (name === "list-conv-files") {
    if (!cb.onConvFileList) return finishTool(cb, assistantMsgId, toolId, "", "not available", "error");
    const list = cb.onConvFileList();
    const out = list.length === 0 ? "(no conversation files)" : list.map(f => `${f.name} (${f.size}b, ${f.mimeType}, ${f.source})`).join("\n");
    return finishTool(cb, assistantMsgId, toolId, out, undefined, "complete");
  }

  if (isConvPath(params.path)) {
    const fname = convFileName(params.path);
    if (name === "read-file" || name === "read-file-range") {
      if (!cb.onConvFileRead) return finishTool(cb, assistantMsgId, toolId, "", "conv read unavailable", "error");
      const f = cb.onConvFileRead(fname);
      if (!f) return finishTool(cb, assistantMsgId, toolId, "", `conv file not found: ${fname}`, "error");
      return finishTool(cb, assistantMsgId, toolId, f.content, undefined, "complete");
    }
    if (name === "write-file") {
      const raw = params.body ?? params.content ?? "";
      if (!cb.onConvFileRead || !cb.onConvFileAdded || !cb.onConvFileUpdate) return finishTool(cb, assistantMsgId, toolId, "", "conv ops unavailable", "error");
      const existing = cb.onConvFileRead(fname);
      if (existing) { cb.onConvFileUpdate(fname, raw); return finishTool(cb, assistantMsgId, toolId, `Updated conv file: ${fname} (${raw.length} bytes)`, undefined, "complete"); }
      cb.onConvFileAdded({ name: fname, path: params.path, mimeType: guessConvMime(fname), size: raw.length, content: raw, isBinary: false });
      return finishTool(cb, assistantMsgId, toolId, `Created conv file: ${fname} (${raw.length} bytes)`, undefined, "complete");
    }
    if (name === "append-file") {
      const raw = params.body ?? params.content ?? "";
      if (!cb.onConvFileRead || !cb.onConvFileUpdate || !cb.onConvFileAdded) return finishTool(cb, assistantMsgId, toolId, "", "conv ops unavailable", "error");
      const existing = cb.onConvFileRead(fname);
      if (existing) { cb.onConvFileUpdate(fname, existing.content + raw); return finishTool(cb, assistantMsgId, toolId, `Appended to conv file: ${fname}`, undefined, "complete"); }
      cb.onConvFileAdded({ name: fname, path: params.path, mimeType: guessConvMime(fname), size: raw.length, content: raw, isBinary: false });
      return finishTool(cb, assistantMsgId, toolId, `Created conv file: ${fname}`, undefined, "complete");
    }
    if (name === "edit-file") {
      const parsed = parseBodyFindReplace(params.body);
      const findStr = parsed ? parsed.find : (params.find ?? "");
      const rawReplace = parsed ? parsed.replace : (params.body ?? params.replace ?? "");
      if (!findStr) return finishTool(cb, assistantMsgId, toolId, "", "edit-file requires 'find' or body sentinels", "error");
      if (!cb.onConvFileRead || !cb.onConvFileUpdate) return finishTool(cb, assistantMsgId, toolId, "", "conv ops unavailable", "error");
      const f = cb.onConvFileRead(fname);
      if (!f) return finishTool(cb, assistantMsgId, toolId, "", `conv file not found: ${fname}`, "error");
      const matches = f.content.split(findStr).length - 1;
      if (matches === 0) return finishTool(cb, assistantMsgId, toolId, "", `find did not match in conv file ${fname}`, "error");
      if (matches > 1) return finishTool(cb, assistantMsgId, toolId, "", `find matched ${matches} locations in conv file ${fname}. Add more context or use replace-all-in-file.`, "error");
      cb.onConvFileUpdate(fname, f.content.replace(findStr, rawReplace));
      return finishTool(cb, assistantMsgId, toolId, `Edited conv file: ${fname}`, undefined, "complete");
    }
    if (name === "replace-all-in-file") {
      const parsed = parseBodyFindReplace(params.body);
      const findStr = parsed ? parsed.find : (params.find ?? "");
      const rawReplace = parsed ? parsed.replace : (params.body ?? params.replace ?? "");
      if (!findStr) return finishTool(cb, assistantMsgId, toolId, "", "replace-all-in-file requires 'find' or body sentinels", "error");
      if (!cb.onConvFileRead || !cb.onConvFileUpdate) return finishTool(cb, assistantMsgId, toolId, "", "conv ops unavailable", "error");
      const f = cb.onConvFileRead(fname);
      if (!f) return finishTool(cb, assistantMsgId, toolId, "", `conv file not found: ${fname}`, "error");
      if (!f.content.includes(findStr)) return finishTool(cb, assistantMsgId, toolId, "", `find did not match in conv file ${fname}`, "error");
      cb.onConvFileUpdate(fname, f.content.split(findStr).join(rawReplace));
      return finishTool(cb, assistantMsgId, toolId, `Replaced all in conv file: ${fname}`, undefined, "complete");
    }
    if (name === "delete-file") {
      if (!cb.onConvFileDelete) return finishTool(cb, assistantMsgId, toolId, "", "conv delete unavailable", "error");
      const ok = cb.onConvFileDelete(fname);
      return finishTool(cb, assistantMsgId, toolId, ok ? `Deleted conv file: ${fname}` : "", ok ? undefined : `conv file not found: ${fname}`, ok ? "complete" : "error");
    }
    if (name === "file-exists") {
      const exists = cb.onConvFileRead ? cb.onConvFileRead(fname) !== null : false;
      return finishTool(cb, assistantMsgId, toolId, exists ? "true" : "false", undefined, "complete");
    }
  }

  if (name === "present-file") {
    const fname = params.name || "untitled.txt";
    const content = params.body ?? params.content ?? "";
    const mimeType = params.mimeType || guessConvMime(fname);
    cb.onMessageUpdate(assistantMsgId, (msg) => {
      const segs = [...(msg.segments ?? [])];
      const toolIdx = segs.findIndex(s => s.kind === "tool" && s.call.id === toolId);
      if (toolIdx >= 0) segs.splice(toolIdx, 1);
      segs.push({ kind: "file", name: fname, content, mimeType, size: content.length });
      return { segments: segs };
    });
    if (cb.onConvFileAdded) {
      cb.onConvFileAdded({ name: fname, path: `conv:${fname}`, mimeType, size: content.length, content, isBinary: false });
    }
    return finishTool(cb, assistantMsgId, toolId, `Presented file: ${fname} (${content.length} bytes)`, undefined, "complete");
  }

  const MAX_RETRIES = 3;
  let lastResult = "";
  let lastErr: unknown = null;
  let emptyRetried = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal.aborted) return finishTool(cb, assistantMsgId, toolId, "", "Aborted", "denied");
    try {
      const result = await dispatchTool(name, params, workingDir, mcpServers);
      lastResult = result;
      lastErr = null;
      const isEmpty = typeof result !== "string" || result.trim().length === 0;
      if (isEmpty && !emptyRetried && attempt < MAX_RETRIES) {
        emptyRetried = true;
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      if (isMutator(name)) {
        cb.onActivity({ type: "file_modified", label: `${name} ${params.path || params.destination || ""}`.trim() });
        if (cb.onConvFileAdded && params.path && !isConvPath(params.path) && (name === "write-file" || name === "append-file" || name === "edit-file" || name === "replace-all-in-file")) {
          (async () => {
            try {
              const content = await readFileSafe(params.path, workingDir);
              if (content !== null) {
                const name_ = params.path.split(/[\\/]/).pop() || params.path;
                cb.onConvFileAdded!({ name: name_, path: params.path, mimeType: guessConvMime(name_), size: content.length, content, isBinary: false });
              }
            } catch { /* mirror failure non-fatal */ }
          })();
        }
      } else if (name === "run-command") {
        cb.onActivity({ type: "command_exec", label: params.body ?? params.command ?? "" });
      }
      return finishTool(cb, assistantMsgId, toolId, result, undefined, "complete");
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient = isTransientToolError(msg);
      if (!transient || attempt === MAX_RETRIES) {
        cb.onActivity({ type: "message", label: `${name} failed`, detail: msg });
        return finishTool(cb, assistantMsgId, toolId, "", msg, "error");
      }
      const delay = Math.min(250 * Math.pow(2, attempt), 2000);
      cb.onActivity({ type: "message", label: `${name} transient error â€” retrying`, detail: msg });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  if (lastErr) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    return finishTool(cb, assistantMsgId, toolId, "", msg, "error");
  }
  return finishTool(cb, assistantMsgId, toolId, lastResult, undefined, "complete");
}

function updateToolStatus(cb: AgentCallbacks, msgId: string, toolId: string, patch: Partial<ToolCallRecord>) {
  cb.onMessageUpdate(msgId, (m): Partial<Message> => {
    const segs = (m.segments ?? []).map(s => {
      if (s.kind === "tool" && s.call.id === toolId) {
        return { kind: "tool", call: { ...s.call, ...patch } } as MessageSegment;
      }
      return s;
    });
    return { segments: segs };
  });
}

function finishTool(
  cb: AgentCallbacks,
  msgId: string,
  toolId: string,
  result: string,
  error: string | undefined,
  status: "complete" | "error" | "denied",
): ToolOutcome {
  const MAX_DISPLAY_CHARS = 50000;
  let displayResult = result;
  if (result.length > MAX_DISPLAY_CHARS) {
    displayResult = result.slice(0, MAX_DISPLAY_CHARS) +
      `... (truncated ${result.length - MAX_DISPLAY_CHARS} additional characters for performance)`;
  }
  const MAX_MODEL_CHARS = 30000;
  const modelResult = result.length > MAX_MODEL_CHARS
    ? result.slice(0, MAX_MODEL_CHARS) + `\n[RESULT COMPACTED: ${result.length - MAX_MODEL_CHARS} characters omitted. Use read-file-range or search-files for the relevant section.]`
    : result;
  updateToolStatus(cb, msgId, toolId, { status, result: displayResult, finishedAt: Date.now() });
  return { text: error ? `ERROR: ${error}` : (modelResult || "(no output)"), ok: status === "complete" };
}

function isTransientToolError(msg: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  const deterministic = [
    "not found", "no such file", "does not exist",
    "permission denied", "access denied", "access is denied",
    "invalid", "unknown tool", "blocked", "outside",
    "already exists", "is a directory", "not a directory",
    "requires", "must be", "bad request", "unauthorized", "forbidden",
  ];
  for (const d of deterministic) if (m.includes(d)) return false;
  const transient = [
    "timeout", "timed out", "temporarily", "busy", "locked",
    "resource", "econnreset", "econnrefused", "etimedout", "epipe",
    "network", "stream", "broken pipe", "again", "would block",
    "os error 32", "os error 33", "sharing violation",
  ];
  for (const t of transient) if (m.includes(t)) return true;
  return false;
}

async function readFileSafe(filePath: string, baseDir: string | undefined): Promise<string | null> {
  try {
    return await invoke<string>("tool_read_file", { path: filePath, baseDir });
  } catch {
    return null;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function findOccurrenceLines(haystack: string, needle: string, max = 5): number[] {
  const lines: number[] = [];
  if (!needle) return lines;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1 && lines.length < max) {
    const lineNum = haystack.slice(0, idx).split("\n").length;
    lines.push(lineNum);
    idx += needle.length;
  }
  return lines;
}

async function guardUniqueMatch(
  filePath: string,
  find: string,
  baseDir: string | undefined,
  toolName: string,
): Promise<string | null> {
  if (!filePath) return null;
  const content = await readFileSafe(filePath, baseDir);
  if (content === null) return null; // Let the underlying tool emit the real error.
  const count = countOccurrences(content, find);
  if (count === 0) {
    return `ERROR: ${toolName} 'find' string did not match any content in ${filePath}. The file may have changed since you last read it, or the indentation/whitespace differs. Re-read the file and use an exact byte-for-byte match.`;
  }
  if (count > 1) {
    const lines = findOccurrenceLines(content, find, 5);
    return `ERROR: ${toolName} 'find' string matched ${count} locations in ${filePath} (lines ${lines.join(", ")}${count > lines.length ? ", ..." : ""}). Add more surrounding context to the 'find' string so it uniquely identifies one location, or use replace-all-in-file if you want every match replaced.`;
  }
  return null;
}

async function guardAnyMatch(
  filePath: string,
  find: string,
  baseDir: string | undefined,
  toolName: string,
): Promise<string | null> {
  if (!filePath) return null;
  const content = await readFileSafe(filePath, baseDir);
  if (content === null) return null;
  const count = countOccurrences(content, find);
  if (count === 0) {
    return `ERROR: ${toolName} 'find' string did not match any content in ${filePath}. Re-read the file and use an exact byte-for-byte match.`;
  }
  return null;
}

function buildChangeWarning(filePath: string, baseDir: string | undefined, current: string): string {
	const { changed, lastReadAt } = checkFileChanged(filePath, baseDir, current);
	if (!changed) return "";
	const ago = lastReadAt ? Math.round((Date.now() - lastReadAt) / 1000) : 0;
	return `WARNING: ${filePath} has changed since you last read it ${ago}s ago. The file on disk may differ from what you remember. Re-read before proceeding if the edit relies on prior content.\n\n`;
}

function parseBodyFindReplace(body: string | undefined): { find: string; replace: string } | null {
	if (!body) return null;
	const FIND_MARK = "<<<FIND>>>";
	const REPL_MARK = "<<<REPLACE>>>";
	const END_MARK = "<<<END>>>";
	const findIdx = body.indexOf(FIND_MARK);
	if (findIdx === -1) return null;
	const replIdx = body.indexOf(REPL_MARK, findIdx + FIND_MARK.length);
	if (replIdx === -1) return null;
	const endIdx = body.indexOf(END_MARK, replIdx + REPL_MARK.length);
	let find = body.slice(findIdx + FIND_MARK.length, replIdx);
	let replace = endIdx === -1
		? body.slice(replIdx + REPL_MARK.length)
		: body.slice(replIdx + REPL_MARK.length, endIdx);
	if (find.startsWith("\n")) find = find.slice(1);
	if (find.endsWith("\n")) find = find.slice(0, -1);
	if (replace.startsWith("\n")) replace = replace.slice(1);
	if (replace.endsWith("\n")) replace = replace.slice(0, -1);
	return { find, replace };
}

async function dispatchTool(
  name: string,
  params: Record<string, string>,
  baseDir: string,
  mcpServers?: McpServer[],
): Promise<string> {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    const serverId = parts[1];
    const toolName = parts.slice(2).join("__");
    const server = mcpServers?.find(s => s.id === serverId && s.status === "connected");
    if (!server) return `Error: MCP server '${serverId}' not connected`;
    const STRICT_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === "body") continue;
      const trimmed = v.trim();
      const looksStructured =
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"));
      const isBool = trimmed === "true" || trimmed === "false";
      const isStrictNumber = STRICT_DECIMAL.test(trimmed);
      if (looksStructured || isBool || isStrictNumber) {
        try { args[k] = JSON.parse(trimmed); continue; } catch { }
      }
      // MCP tool bodies often arrive in the text protocol with escaped
      // newlines/quotes. Decode those before sending Luau or edit content.
      if (trimmed.includes("\\n") || trimmed.includes("\\\"")) {
        args[k] = trimmed.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\"/g, '"');
        continue;
      }
      args[k] = v;
    }
    // Roblox enforces datamodel targets. LocalPlayer/PlayerGui code only
    // exists in the Client datamodel, never Edit; correct that common model
    // mistake before dispatching the request.
    if (toolName === "execute_luau" && typeof args.code === "string" && /LocalPlayer|PlayerGui|PlayerScripts/.test(args.code) && args.datamodel_type === "Edit") {
      args.datamodel_type = "Client";
    }
    if (toolName === "multi_edit" && typeof args.edits === "string" && !args.edits.trim().startsWith("[")) {
      const raw = args.edits.trim();
      const marker = raw.indexOf("new_string:");
      if (marker >= 0) args.edits = [{ old_string: "", new_string: raw.slice(marker + "new_string:".length).trim() }];
    }
    let result;
    try {
      result = await mcpCallTool(server, toolName, args);
    } catch (firstError) {
      // Refresh a stale Roblox session once before surfacing the tool error.
      if (server.id.toLowerCase().includes("roblox")) {
        await import("./mcp").then(({ mcpConnect }) => mcpConnect(server).catch(() => {}));
        result = await mcpCallTool(server, toolName, args);
      } else {
        throw firstError;
      }
    }
    const text = mcpToolResultToText(result);
    if (result.isError) throw new Error(text || "MCP tool returned an error");
    return text;
  }

  const bd = baseDir || undefined;
  switch (name) {
    case "read-file": {
      const path = resolveToolPath(params);
      if (!path) return "ERROR: read-file requires a non-empty path attribute.";
      const content = await invoke<string>("tool_read_file", { path, baseDir: bd });
      recordFileRead(path, bd, content);
      return content;
    }
    case "read-file-range": {
      const path = resolveToolPath(params);
      if (!path) return "ERROR: read-file-range requires a non-empty path attribute.";
      const content = await invoke<string>("tool_read_file_range", {
        path,
        start: Number(params.start || "1"),
        end: Number(params.end || "200"),
        baseDir: bd,
      });
      recordFileRead(path, bd, content);
      return content;
    }
case "write-file": {
      const raw = params.body ?? params.content ?? "";
      const clean = await sanitizeWriteContent(raw, params.path, bd);
      const existing = await readFileSafe(params.path, bd);
      const warn = existing !== null ? buildChangeWarning(params.path, bd, existing) : "";
      const result = await invoke<string>("tool_write_file", { path: params.path, content: clean, baseDir: bd });
      recordFileRead(params.path, bd, clean);
      return warn + result;
    }
    case "append-file": {
      const raw = params.body ?? params.content ?? "";
      const clean = await sanitizeWriteContent(raw, params.path, bd);
      const existing = await readFileSafe(params.path, bd);
      const warn = existing !== null ? buildChangeWarning(params.path, bd, existing) : "";
      const result = await invoke<string>("tool_append_file", { path: params.path, content: clean, baseDir: bd });
      const after = await readFileSafe(params.path, bd);
      if (after !== null) recordFileRead(params.path, bd, after);
      return warn + result;
    }
    case "edit-file": {
      const parsed = parseBodyFindReplace(params.body);
      const findStr = parsed ? parsed.find : (params.find ?? "");
      const rawReplace = parsed ? parsed.replace : (params.body ?? params.replace ?? "");
      if (!findStr) {
        return "ERROR: edit-file requires either a non-empty 'find' attribute, or a body containing <<<FIND>>>...<<<REPLACE>>>...<<<END>>> sentinels.";
      }
      const guard = await guardUniqueMatch(params.path, findStr, bd, "edit-file");
      if (guard) return guard;
      const before = await readFileSafe(params.path, bd);
      const warn = before !== null ? buildChangeWarning(params.path, bd, before) : "";
      const cleanReplace = await sanitizeWriteContent(rawReplace, params.path, bd);
      const result = await invoke<string>("tool_edit_file", {
        path: params.path,
        find: findStr,
        replace: cleanReplace,
        baseDir: bd,
      });
      const after = await readFileSafe(params.path, bd);
      if (after !== null) recordFileRead(params.path, bd, after);
      return warn + result;
    }
    case "create-directory":
      return invoke<string>("tool_create_directory", { path: params.path, baseDir: bd });
    case "copy-file":
      return invoke<string>("tool_copy_file", { source: params.source, destination: params.destination, baseDir: bd });
    case "move-file":
      return invoke<string>("tool_move_file", { source: params.source, destination: params.destination, baseDir: bd });
    case "delete-file":
      return invoke<string>("tool_delete_file", { path: params.path, baseDir: bd });
    case "file-exists":
      return invoke<string>("tool_file_exists", { path: params.path, baseDir: bd });
    case "file-info":
      return invoke<string>("tool_file_info", { path: params.path, baseDir: bd });
    case "list-directory":
      return invoke<string>("tool_list_directory", { path: params.path || ".", baseDir: bd });
    case "search-files":
      return invoke<string>("tool_search_files", { path: params.path || ".", query: params.query, baseDir: bd });
    case "run-command":
      return invoke<string>("tool_run_command", { command: params.body ?? params.command ?? "", workdir: bd });
    case "codex-cli":
      return invoke<string>("codex_cli_run", { prompt: params.prompt ?? params.body ?? "", workingDir: baseDir || "." });
    case "fetch-url":
      return invoke<string>("tool_fetch_url", { url: params.url });
    case "count-lines":
      return invoke<string>("tool_count_lines", { path: params.path, baseDir: bd });
case "replace-all-in-file": {
      const parsed = parseBodyFindReplace(params.body);
      const findStr = parsed ? parsed.find : (params.find ?? "");
      const rawReplace = parsed ? parsed.replace : (params.body ?? params.replace ?? "");
      if (!findStr) {
        return "ERROR: replace-all-in-file requires either a non-empty 'find' attribute, or a body containing <<<FIND>>>...<<<REPLACE>>>...<<<END>>> sentinels.";
      }
      const guard = await guardAnyMatch(params.path, findStr, bd, "replace-all-in-file");
      if (guard) return guard;
      const before = await readFileSafe(params.path, bd);
      const warn = before !== null ? buildChangeWarning(params.path, bd, before) : "";
      const cleanReplace = await sanitizeWriteContent(rawReplace, params.path, bd);
      const result = await invoke<string>("tool_replace_all_in_file", {
        path: params.path,
        find: findStr,
        replace: cleanReplace,
        baseDir: bd,
      });
      const after = await readFileSafe(params.path, bd);
      if (after !== null) recordFileRead(params.path, bd, after);
      return warn + result;
    }
    case "read-multiple-files": {
      const raw = params.paths ?? params.body ?? "";
      const pathList = raw.includes("\n")
        ? raw.split("\n").map((p: string) => p.trim()).filter(Boolean)
        : raw.split(",").map((p: string) => p.trim()).filter(Boolean);
      return invoke<string>("tool_read_multiple_files", { paths: pathList, baseDir: bd });
    }
    case "get-env":
      return invoke<string>("tool_get_env", { key: params.key ?? params.name ?? "" });
    case "path-type":
      return invoke<string>("tool_path_type", { path: params.path, baseDir: bd });
case "get-cwd":
			return invoke<string>("tool_get_cwd");
		case "get-skill-secret":
			return getSkillSecretValue(params, baseDir);
		default:
			throw new Error(`Unknown tool: ${name}`);
  }
}

async function getSkillSecretValue(params: Record<string, string>, baseDir: string): Promise<string> {
	const skillName = (params.skill || "").trim();
	const fieldKey = (params.field || "").trim();
	if (!skillName) return "ERROR: missing 'skill' parameter";
	if (!fieldKey) return "ERROR: missing 'field' parameter";

	if (!isSkillVaultUnlocked()) {
		return "ERROR: Skill vault is locked. Ask the user to unlock it in Settings â†’ Skills, then retry.";
	}

	const roots = resolveSkillRoots(baseDir, "");
	let skills: SkillEntry[] = [];
	try {
		skills = await loadSkills(roots);
	} catch {
		return "ERROR: failed to enumerate skills";
	}
	const skill = skills.find(s => s.name === skillName);
	if (!skill) return `ERROR: skill '${skillName}' not found`;

	const schema = await loadSkillSchema(skill.relPath);
	if (!schema) return `ERROR: skill '${skillName}' has no settings.json schema`;

	const field = schema.fields.find(f => f.key === fieldKey);
	if (!field) return `ERROR: field '${fieldKey}' not defined in skill '${skillName}' settings`;
	if (!field.secret) return `ERROR: field '${fieldKey}' is not a secret field â€” use the value the user provided directly`;

	let values: Record<string, string | number | boolean | null>;
	try {
		values = await getDecryptedSkillSettings(skillName, schema);
	} catch (e) {
		return `ERROR: decryption failed: ${e instanceof Error ? e.message : String(e)}`;
	}

	const v = values[fieldKey];
	if (v === null || v === undefined || v === "") {
		return `ERROR: no value stored for '${fieldKey}' in skill '${skillName}'. Ask the user to configure it in Settings â†’ Skills.`;
	}
	return String(v);
}

function renderHistoryBlock(messages: { role: "user" | "assistant"; content: string }[]): string {
  if (messages.length === 0) return "";
  const rendered = messages.map((m) => {
    const label = m.role === "user" ? "USER" : "ASSISTANT";
    const raw = m.content.trim();
    let body: string;
    if (m.role === "assistant") {
      body = sanitizeForPrompt(stripWaitSentinels(raw));
    } else if (raw.startsWith("<tool_results>") && raw.endsWith("</tool_results>")) {
      body = sanitizeForPrompt(raw);
    } else {
      body = raw;
    }
    return `[${label}]\n${body}\n[END ${label}]`;
  });
  const budget = 60000;
  let used = 0;
  const turns: string[] = [];
  for (let index = rendered.length - 1; index >= 0; index--) {
    const turn = rendered[index];
    if (turns.length > 0 && used + turn.length > budget) break;
    turns.unshift(turn);
    used += turn.length;
  }
  const omitted = rendered.length - turns.length;
  const prefix = omitted > 0 ? `[COMPACTED ${omitted} OLDER TURNS]\nUse the current task and recent verified tool results as the source of truth.\n\n` : "";
  return `CONVERSATION HISTORY:\n\n${prefix}${turns.join("\n\n")}\n\nContinue the conversation. The last USER message above is your current task.`;
}

function stripWaitSentinels(text: string): string {
  return text
    .replace(/\[WAIT-FOR-RESULTS\][\s\S]*?\[\/WAIT-FOR-RESULTS\]/gi, "")
    .replace(/\[WAIT-FOR-RESULTS\]|\[\/WAIT-FOR-RESULTS\]/gi, "")
    .replace(/\[TAG:[^\]]+\]/gi, "")
    .replace(/\[END\s+(?:USER|ASSISTANT)\]/gi, "")
    .replace(/\[TOOL_RESULTS\][\s\S]*?\[\/TOOL_RESULTS\]/gi, "");
}

function renderUserTurn(text: string, attachments?: Attachment[]): string {
  if (!attachments || attachments.length === 0) return text;
  const ATTACHMENT_INLINE_LIMIT = 200_000;
  const blocks = attachments.map(a => {
    const header = `[Attachment: ${a.name}${a.size ? ` (${a.size} bytes)` : ""}${a.mimeType ? ` ${a.mimeType}` : ""}]`;
    const isImage = /^image\//i.test(a.mimeType) || !!a.thumbDataUrl;
    if (isImage) {
      return `${header}\n(See ATTACHED IMAGES section in system prompt.)`;
    }
    if (a.isBinary) return `${header}\n(binary file, not shown inline${a.path ? `; path: ${a.path}` : ""})`;
    const full = a.content || "";
    if (full.length <= ATTACHMENT_INLINE_LIMIT) return `${header}\n${full}`;
    const body = full.slice(0, ATTACHMENT_INLINE_LIMIT);
    const truncatedNote = `\n[...truncated for prompt size \u2014 original was ${full.length} characters, only the first ${ATTACHMENT_INLINE_LIMIT} are shown. Use read-file-range to fetch more.]`;
    return `${header}\n${body}${truncatedNote}`;
  });
  return [text, ...blocks].join("\n\n");
}

function whyApprovalNeeded(name: string, params: Record<string, string>, settings: AppSettings): string | null {
  const a = settings.approvals;
	if (a.requireRunCommand && name === "run-command") return "run-command requires approval";
  if (a.requireFileWrite && (name === "write-file" || name === "edit-file" || name === "append-file"))
		return "File write requires approval";
	if (a.requireFileDelete && name === "delete-file") return "delete-file requires approval";
	if (a.requireNetworkRequest && name === "fetch-url") return "fetch-url requires approval";
if (name === "read-file" || name === "read-file-range") {
    const path = params.path || "";
    if (SENSITIVE_PATH_PATTERNS.some(rx => rx.test(path))) return `Reading sensitive file: ${path}`;
		if (a.requireEnvRead && /\.env/i.test(path)) return "Reading .env file";
  }
  return null;
}

function matchCommandRule(cmd: string, rules: CommandRule[]): "approve" | "deny" | null {
  if (!cmd || rules.length === 0) return null;
  const trimmed = cmd.trim();
  const base = trimmed.split(/\s+/)[0] ?? "";
  for (const r of rules) {
    const pat = r.pattern.trim();
    if (!pat) continue;
    let hit = false;
    if (r.match === "exact") hit = trimmed === pat;
    else if (r.match === "prefix") hit = trimmed === pat || trimmed.startsWith(pat + " ") || trimmed.startsWith(pat + "\n");
    else if (r.match === "base") hit = base === pat;
    if (hit) return r.action === "approve" ? "approve" : "deny";
  }
  return null;
}

function riskFor(name: string, params: Record<string, string>): "low" | "medium" | "high" {
  if (name === "delete-file" || name === "run-command") return "high";
  if (name === "write-file" || name === "edit-file" || name === "move-file") return "medium";
  const path = params.path || "";
  if ((name === "read-file" || name === "read-file-range") && /\.env|secret|key|pem|credential/i.test(path)) return "high";
  return "low";
}

function isMutator(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

function extractPaths(params: Record<string, string>): string[] {
  const out: string[] = [];
  for (const key of ["path", "source", "destination"]) {
    const v = params[key];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  return out;
}

function resolveToolPath(params: Record<string, string>): string {
  const explicit = params.path || params.file || params.filename;
  if (explicit?.trim()) return explicit.trim();
  const body = params.body?.trim();
  if (body && !body.includes("\n") && !body.includes("=")) return body;
  return "";
}

function isCaseInsensitiveFs(): boolean {
  try {
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return true;
    return false;
  } catch {
    return false;
  }
}

function isInsideDir(path: string, dir: string): boolean {
  if (!dir) return true;
  const p = normalizePath(path);
  const d = normalizePath(dir);
  if (!isAbsolutePath(p)) return true;
  const ci = isCaseInsensitiveFs();
  const pp = ci ? p.toLowerCase() : p;
  const dd = ci ? d.toLowerCase() : d;
  return pp.startsWith(dd + (dd.endsWith("/") ? "" : "/")) || pp === dd;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function isAbsolutePath(p: string): boolean {
  return /^([a-zA-Z]:\/|\/)/.test(p);
}

function findToolSegment(segs: MessageSegment[], id: string): number {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === "tool" && s.call.id === id) return i;
  }
  return -1;
}

function formatRaw(name: string, params: Record<string, string>): string {
  const parts: string[] = [];
  parts.push('<invoke name="' + name + '">');
  for (const [k, v] of Object.entries(params)) {
    const preview = v.length > 200 ? v.slice(0, 200) + "..." : v;
    parts.push('  <parameter name="' + k + '">' + preview + "</parameter>");
  }
  parts.push("</invoke>");
  return parts.join("\n");
}

async function sanitizeWriteContent(raw: string, path: string, baseDir?: string): Promise<string> {
	if (!raw) return raw;
	let preserveExisting = false;
	try {
		const existing = await invoke<string>("tool_read_file", { path, baseDir });
		if (existing && hasNonAscii(existing)) preserveExisting = true;
	} catch {
	}
	const result = sanitizeForWrite(raw, { preserveExisting });
	return result.content;
}

export type { FileSnapshot };function collectImageAttachments(conv: Conversation, current?: Attachment[]): Attachment[] {
	const out: Attachment[] = [];
	const seen = new Set<string>();
	const isImage = (a: Attachment) => /^image\//i.test(a.mimeType) || !!a.thumbDataUrl;
	const push = (a: Attachment) => {
		if (!isImage(a) || !a.content) return;
		const key = `${a.name}|${a.size ?? 0}|${a.content.length}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push(a);
	};
	for (const m of conv.messages) {
		if (m.role !== "user" || !m.attachments) continue;
		for (const a of m.attachments) push(a);
	}
	if (current) for (const a of current) push(a);
	return out;
}
