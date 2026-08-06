import { useState, useEffect, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import LZString from "lz-string";
import { readTextFile, writeTextFile, exists, mkdir, readDir, remove, rename } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";

const writeQueue = new Map<string, { running: Promise<void>; pending: string | null }>();
let consecutiveWriteFailures = 0;
let writeFailureNotified = false;
let onPersistFailure: (() => void) | null = null;

function queueWrite(path: string, content: string): Promise<void> {
  const existing = writeQueue.get(path);
  if (existing) {
    existing.pending = content;
    return existing.running;
  }

  const entry: { running: Promise<void>; pending: string | null } = {
    running: Promise.resolve(),
    pending: null,
  };

  const runChain = async () => {
    let current: string | null = content;
    while (current !== null) {
      try {
        await writeTextFile(path, current, { baseDir: BaseDirectory.AppData });
        consecutiveWriteFailures = 0;
        writeFailureNotified = false;
      } catch (e) {
        console.error("[conv-store] write failed for", path, e);
        consecutiveWriteFailures += 1;
        if (consecutiveWriteFailures >= 3 && !writeFailureNotified) {
          writeFailureNotified = true;
          onPersistFailure?.();
        }
      }
      current = entry.pending;
      entry.pending = null;
    }
    writeQueue.delete(path);
  };

  entry.running = runChain();
  writeQueue.set(path, entry);
  return entry.running;
}
import type {
  Conversation, Workspace, Message, AppSettings, MemoryEntry,
  QueuedMessage, ActivityEvent, AgentStatus, InAppNotification, MemoryType, Attachment, ConvFile
} from "../types";

const DEFAULT_WS: Workspace = {
  id: "default",
  name: "Personal",
  color: "#5865f2",
  icon: "ðŸ ",
  workingDirectory: "",
  systemPrompt: "",
  instructions: "",
  notes: "",
  pinnedFiles: [],
  recentFiles: [],
  createdAt: Date.now(),
};

const DEFAULT_SETTINGS: AppSettings = {
  approvals: {
    requireRunCommand: true,
    requireFileWrite: false,
    requireFileDelete: true,
    requireNetworkRequest: false,
    requireEnvRead: true,
    requireFileRead: false,
  },
  approvalDefaultsVersion: 2,
  fontSize: 14,
  sendOnEnter: true,
  workdir: "",
  notifyOnDone: true,
  notifyOnApproval: true,
  nickname: "",
  instructions: "",
  memories: [],
  defaultModel: "google:gemini-3.5-flash-lite",
compactMode: false,
  sounds: false,
  mcpServers: [],
  commandRules: [],
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function save<T>(key: string, val: T) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (err) {
    console.warn(`Failed to save ${key} to localStorage`, err);
  }
}

function saveCompressed<T>(key: string, val: T) {
  const compressed = LZString.compressToUTF16(JSON.stringify(val));
  localStorage.setItem(key, compressed);
}

function loadCompressed<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const decompressed = LZString.decompressFromUTF16(raw);
    if (decompressed) {
      try {
        const parsed = JSON.parse(decompressed);
        if (parsed !== null && parsed !== undefined) return parsed;
      } catch { /* fall through to legacy path */ }
    }
    const head = raw.charCodeAt(0);
    if (head === 0x7b || head === 0x5b) { // { or [
      try {
        const legacy = JSON.parse(raw);
        if (legacy !== null && legacy !== undefined) return legacy;
      } catch { /* not valid JSON either */ }
    }
    return fallback;
  } catch { return fallback; }
}


export function useAppStore() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    const saved = load<Workspace[]>("workspaces", [DEFAULT_WS]);
    return saved.map(w => ({ ...DEFAULT_WS, ...w }));
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);

  useEffect(() => {
    async function loadAll() {
      try {
        const hasDir = await exists("conversations", { baseDir: BaseDirectory.AppData });
        if (!hasDir) {
          const legacy = loadCompressed<Conversation[]>("conversations", []);
          if (legacy && legacy.length > 0) {
            try {
              await mkdir("conversations", { baseDir: BaseDirectory.AppData, recursive: true });
            } catch (e) {
              console.error("[conv-store] mkdir(conversations) failed during migration â€” conversations cannot be persisted to disk:", e);
            }
            let successCount = 0;
            await Promise.all(legacy.map(async c => {
              try {
                await writeTextFile(`conversations/${c.id}.json`, JSON.stringify(c), { baseDir: BaseDirectory.AppData });
                successCount++;
              } catch (e) {
                console.error("[conv-store] migration write failed for", c.id, e);
              }
            }));
            if (successCount === legacy.length) {
              try { localStorage.removeItem("conversations"); } catch {}
            }
            const seed = new Map<string, Conversation>();
            for (const c of legacy) seed.set(c.id, c);
            lastSavedRef.current = seed;
            setConversations(legacy);
          } else {
            try { localStorage.removeItem("conversations"); } catch {}
          }
          setConversationsLoaded(true);
          return;
        }

        const entries = await readDir("conversations", { baseDir: BaseDirectory.AppData });
        const loaded: Conversation[] = [];
        for (const entry of entries) {
          if (!entry.isFile || !entry.name.endsWith(".json")) continue;
          try {
            const content = await readTextFile(`conversations/${entry.name}`, { baseDir: BaseDirectory.AppData });
            if (!content || !content.trim()) {
              console.warn("[conv-store] empty conversation file, skipping:", entry.name);
              continue;
            }
            const parsed = JSON.parse(content) as Conversation;
            if (!parsed || typeof parsed !== "object" || !parsed.id) {
              console.warn("[conv-store] malformed conversation (no id), quarantining:", entry.name);
              try {
                await rename(`conversations/${entry.name}`, `conversations/${entry.name}.corrupt`, {
                  oldPathBaseDir: BaseDirectory.AppData,
                  newPathBaseDir: BaseDirectory.AppData,
                });
              } catch {}
              continue;
            }
            if (!Array.isArray(parsed.messages)) parsed.messages = [];
            const titleText = String(parsed.title ?? "New conversation").replace(/\s+/g, " ").trim();
            const repeatedTitle = titleText.match(/^(.{2,40})\1$/i);
            if (repeatedTitle) parsed.title = repeatedTitle[1].trim();
            parsed.messages = parsed.messages.map((message) => message.streaming
              ? { ...message, streaming: false, segments: undefined, content: message.content?.trim() ? `${message.content}\n\n*Interrupted*` : "*Interrupted*" }
              : message);
            if (parsed.queue && !Array.isArray(parsed.queue)) parsed.queue = [];
            if (parsed.activity && !Array.isArray(parsed.activity)) parsed.activity = [];
            loaded.push(parsed);
          } catch (e) {
            console.error("[conv-store] failed to parse", entry.name, "â€” quarantining as .corrupt:", e);
            try {
              await rename(`conversations/${entry.name}`, `conversations/${entry.name}.corrupt`, {
                oldPathBaseDir: BaseDirectory.AppData,
                newPathBaseDir: BaseDirectory.AppData,
              });
            } catch (renameErr) {
              console.error("[conv-store] could not quarantine corrupt file:", renameErr);
            }
          }
        }
        for (const c of loaded) {
          if (c.deleted && c.deletedAt === undefined) {
            c.deletedAt = c.updatedAt;
          }
        }
        loaded.sort((a, b) => b.updatedAt - a.updatedAt);
        const seed = new Map<string, Conversation>();
        for (const c of loaded) seed.set(c.id, c);
        lastSavedRef.current = seed;
        setConversations(loaded);
        const persistedActiveId = load<string | null>("activeConvId", null);
        if (persistedActiveId) {
          const stillExists = loaded.some(c => c.id === persistedActiveId && !c.deleted && !c.archived);
          if (!stillExists) setActiveConversationId(null);
        }
      } catch (err) {
        console.error("Failed to load conversations", err);
        const legacy = loadCompressed<Conversation[]>("conversations", []);
        if (legacy && legacy.length > 0) {
          const seed = new Map<string, Conversation>();
          for (const c of legacy) seed.set(c.id, c);
          lastSavedRef.current = seed;
          setConversations(legacy);
        }
      } finally {
        setConversationsLoaded(true);
      }
    }
    loadAll();
  }, []);

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = load<AppSettings>("settings", DEFAULT_SETTINGS);
    const merged = { ...DEFAULT_SETTINGS, ...saved, approvals: { ...DEFAULT_SETTINGS.approvals, ...(saved.approvals ?? {}) } };
    if ((saved.approvalDefaultsVersion ?? 1) < 2) {
      merged.approvals.requireFileWrite = false;
      merged.approvalDefaultsVersion = 2;
    }
    if (merged.mcpServers?.length) {
      merged.mcpServers = merged.mcpServers.map(s => ({
        ...s,
        status: "disconnected" as const,
        tools: undefined,
        error: undefined,
      }));
    }
    return merged;
  });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => load("activeWsId", "default"));
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => load("activeConvId", null));
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);

  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { save("workspaces", workspaces); }, [workspaces]);
  const lastSavedRef = useRef<Map<string, Conversation>>(new Map());

  const latestConversationsRef = useRef(conversations);
  useEffect(() => { latestConversationsRef.current = conversations; }, [conversations]);

  useEffect(() => {
    if (!conversationsLoaded) return;

    let cancelled = false;
    let flushing = false;

    const flush = async () => {
      if (flushing || cancelled) return;
      flushing = true;
      try {
        if (!(await exists("conversations", { baseDir: BaseDirectory.AppData }))) {
          try {
            await mkdir("conversations", { baseDir: BaseDirectory.AppData, recursive: true });
          } catch (e) {
            console.error("[conv-store] mkdir(conversations) failed â€” saves will not land:", e);
            return;
          }
        }
        const snapshot = latestConversationsRef.current;
        const currentSaved = new Map<string, Conversation>();

        for (const conv of snapshot) {
          currentSaved.set(conv.id, conv);
          const lastConv = lastSavedRef.current.get(conv.id);
          if (lastConv !== conv) {
            const trimmedActivity = (conv.activity ?? []).slice(-200);
            const toPersist = {
              ...conv,
              activity: trimmedActivity,
            };
            queueWrite(`conversations/${conv.id}.json`, JSON.stringify(toPersist));
          }
        }

        for (const id of lastSavedRef.current.keys()) {
          if (!currentSaved.has(id)) {
            try {
              await remove(`conversations/${id}.json`, { baseDir: BaseDirectory.AppData });
            } catch (e) {
              console.error("[conv-store] remove failed for", id, e);
            }
          }
        }

        lastSavedRef.current = currentSaved;
      } catch (err) {
        console.error("[conv-store] flush error", err);
      } finally {
        flushing = false;
      }
    };

    const interval = window.setInterval(flush, 1500); // Relaxed interval for better perf
    const onBeforeUnload = () => { void flush(); };
    window.addEventListener("beforeunload", onBeforeUnload);

    void flush();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush();
    };
  }, [conversationsLoaded]);
  useEffect(() => {
    if (!conversationsLoaded) return;
    const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const sweep = () => {
      const now = Date.now();
      setConversations(prev => {
        const next = prev.filter(c => {
          if (!c.deleted) return true;
          const stamp = c.deletedAt ?? c.updatedAt;
          return now - stamp < TRASH_TTL_MS;
        });
        return next.length === prev.length ? prev : next;
      });
    };
    sweep();
    const interval = window.setInterval(sweep, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [conversationsLoaded]);

  useEffect(() => { save("settings", settings); }, [settings]);
  useEffect(() => { save("activeWsId", activeWorkspaceId); }, [activeWorkspaceId]);
  useEffect(() => { save("activeConvId", activeConversationId); }, [activeConversationId]);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) ?? workspaces[0] ?? DEFAULT_WS;
  const activeConversation = conversations.find(c => c.id === activeConversationId && !c.deleted && !c.archived) ?? null;
  const workspaceConversations = conversations
    .filter(c => c.workspaceId === activeWorkspaceId && !c.deleted && !c.archived)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.favorited && !b.favorited) return -1;
      if (!a.favorited && b.favorited) return 1;
      return b.updatedAt - a.updatedAt;
    });
  const trashedConversations = conversations.filter(c => c.deleted);
  const archivedConversations = conversations.filter(c => c.archived && !c.deleted);

  const pushNotification = useCallback((n: Omit<InAppNotification, "id" | "timestamp">) => {
    const entry: InAppNotification = { ...n, id: uuidv4(), timestamp: Date.now() };
    setNotifications(prev => [entry, ...prev.slice(0, 49)]);
    return entry;
  }, []);

  useEffect(() => {
    onPersistFailure = () => {
      pushNotification({
        type: "task_failed",
        title: "Saving to disk failed",
        body: "Meridian couldn't write conversation files. Check disk space and AppData permissions â€” recent changes may not survive a restart.",
      });
    };
    return () => { onPersistFailure = null; };
  }, [pushNotification]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const clearNotifications = useCallback(() => setNotifications([]), []);

const createConversation = useCallback((model?: string, mode: "agent" | "chat" = "agent"): Conversation => {
    const conv: Conversation = {
      id: uuidv4(),
      title: "New conversation",
      messages: [],
      workspaceId: activeWorkspaceId,
      model: model ?? settings.defaultModel,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentStatus: "idle",
      queue: [],
      activity: [],
      mode,
    };
    setConversations(prev => [conv, ...prev]);
    setActiveConversationId(conv.id);
    return conv;
  }, [activeWorkspaceId, settings.defaultModel]);

  const softDeleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, deleted: true, deletedAt: Date.now(), agentStatus: "idle", queue: [] } : c));
    setActiveConversationId(prev => prev === id ? null : prev);
  }, []);

  const restoreConversation = useCallback((id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, deleted: false, deletedAt: undefined } : c));
  }, []);

  const permanentDeleteConversation = useCallback((id: string) => {
    const conv = conversationsRef.current.find(c => c.id === id);
    if (conv) {
      import("../lib/agentRunner").then(mod => {
        for (const m of conv.messages) mod.clearBackupsForMessage(m.id);
      }).catch(() => {});
    }
    setConversations(prev => prev.filter(c => c.id !== id));
  }, []);

  const archiveConversation = useCallback((id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, archived: true } : c));
    setActiveConversationId(prev => prev === id ? null : prev);
  }, []);

  const unarchiveConversation = useCallback((id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, archived: false } : c));
  }, []);

  const duplicateConversation = useCallback((id: string): Conversation | null => {
    const orig = conversations.find(c => c.id === id);
    if (!orig) return null;
    const copy: Conversation = {
      ...orig,
      id: uuidv4(),
      title: orig.title + " (copy)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentStatus: "idle",
      queue: [],
      activity: [],
    };
    setConversations(prev => [copy, ...prev]);
    setActiveConversationId(copy.id);
    return copy;
  }, [conversations]);

  const updateConversation = useCallback((id: string, updates: Partial<Conversation>) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c));
  }, []);

  const addMessage = useCallback((convId: string, msg: Message) => {
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() } : c
    ));
  }, []);

  const updateMessage = useCallback((convId: string, msgId: string, updates: Partial<Message>) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, ...updates } : m), updatedAt: Date.now() }
        : c
    ));
  }, []);

  const updateMessageWith = useCallback((convId: string, msgId: string, updater: (m: Message) => Message) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, messages: c.messages.map(m => m.id === msgId ? updater(m) : m), updatedAt: Date.now() }
        : c
    ));
  }, []);

  const deleteMessage = useCallback((convId: string, msgId: string) => {
    import("../lib/agentRunner").then(mod => mod.clearBackupsForMessage(msgId)).catch(() => {});
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, messages: c.messages.filter(m => m.id !== msgId), updatedAt: Date.now() }
        : c
    ));
  }, []);

  const setAgentStatus = useCallback((convId: string, status: AgentStatus) => {
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, agentStatus: status } : c));
  }, []);

  const addActivity = useCallback((convId: string, event: Omit<ActivityEvent, "id" | "timestamp">) => {
    const entry: ActivityEvent = { ...event, id: uuidv4(), timestamp: Date.now() };
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, activity: [...(c.activity ?? []).slice(-99), entry] } : c
    ));
  }, []);

const enqueueMessage = useCallback((convId: string, content: string, attachments?: Attachment[], _mode?: "normal" | "merge" | "websearch"): QueuedMessage => {
    const msg: QueuedMessage = { id: uuidv4(), content, attachments, createdAt: Date.now(), mode: "normal" };
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, queue: [...(c.queue ?? []), msg] } : c
    ));
    return msg;
  }, []);

  const dequeueMessage = useCallback((convId: string): QueuedMessage | null => {
    const conv = conversationsRef.current.find(c => c.id === convId);
    const head = conv?.queue?.[0];
    if (!head) return null;
    setConversations(prev => prev.map(c =>
      c.id === convId && c.queue?.[0]?.id === head.id
        ? { ...c, queue: c.queue.slice(1) }
        : c
    ));
    return head;
  }, []);

  const updateQueuedMessage = useCallback((convId: string, msgId: string, content: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, queue: (c.queue ?? []).map(q => q.id === msgId ? { ...q, content } : q) }
        : c
    ));
  }, []);

  const deleteQueuedMessage = useCallback((convId: string, msgId: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, queue: (c.queue ?? []).filter(q => q.id !== msgId) }
        : c
    ));
  }, []);

  const reorderQueue = useCallback((convId: string, fromIdx: number, toIdx: number) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== convId || !c.queue) return c;
      const q = [...c.queue];
      const [item] = q.splice(fromIdx, 1);
      q.splice(toIdx, 0, item);
      return { ...c, queue: q };
    }));
  }, []);

  const clearQueue = useCallback((convId: string) => {
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, queue: [] } : c));
  }, []);


  const createWorkspace = useCallback((data: Omit<Workspace, "id" | "createdAt">) => {
    const ws: Workspace = { ...DEFAULT_WS, ...data, id: uuidv4(), createdAt: Date.now() };
    setWorkspaces(prev => [...prev, ws]);
    setActiveWorkspaceId(ws.id);
    return ws;
  }, []);

  const updateWorkspace = useCallback((id: string, updates: Partial<Workspace>) => {
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w));
  }, []);

  const deleteWorkspace = useCallback((id: string) => {
    if (id === "default") return;
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    setConversations(prev => prev.filter(c => c.workspaceId !== id));
    setActiveWorkspaceId("default");
    setActiveConversationId(null);
  }, []);

  const reorderWorkspaces = useCallback((fromIdx: number, toIdx: number) => {
    setWorkspaces(prev => {
      const arr = [...prev];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  }, []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const updateMcpServers = useCallback((servers: import("../types").McpServer[]) => {
    setSettings(prev => ({ ...prev, mcpServers: servers }));
  }, []);

  const togglePin = useCallback((id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, favorited: !c.favorited } : c));
  }, []);

  const addMemory = useCallback((content: string, type: MemoryType = "user", workspaceId?: string, source: "manual" | "agent" = "manual"): MemoryEntry => {
    const entry: MemoryEntry = { id: uuidv4(), content, createdAt: Date.now(), type, workspaceId, enabled: true, source };
    setSettings(prev => ({ ...prev, memories: [...(prev.memories ?? []), entry] }));
    return entry;
  }, []);

  const updateMemory = useCallback((id: string, updates: Partial<MemoryEntry>) => {
    setSettings(prev => ({
      ...prev,
      memories: (prev.memories ?? []).map(m => m.id === id ? { ...m, ...updates } : m)
    }));
  }, []);

  const deleteMemory = useCallback((id: string) => {
    setSettings(prev => ({ ...prev, memories: (prev.memories ?? []).filter(m => m.id !== id) }));
  }, []);

  const toggleMemory = useCallback((id: string) => {
    setSettings(prev => ({
      ...prev,
      memories: (prev.memories ?? []).map(m => m.id === id ? { ...m, enabled: !m.enabled } : m)
    }));
  }, []);

  const exportConversation = useCallback((id: string): string => {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return "";
    return JSON.stringify(conv, null, 2);
  }, [conversations]);

  const importConversation = useCallback((json: string) => {
    try {
      const conv = JSON.parse(json) as Conversation;
      const imported: Conversation = {
        ...conv,
        id: uuidv4(),
        workspaceId: activeWorkspaceId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        agentStatus: "idle",
        queue: [],
        activity: [],
      };
      setConversations(prev => [imported, ...prev]);
      setActiveConversationId(imported.id);
      return imported;
    } catch { return null; }
  }, [activeWorkspaceId]);

  const saveDraft = useCallback((convId: string, draft: string) => {
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, draft } : c));
  }, []);

  const addConvFile = useCallback((convId: string, file: Omit<ConvFile, "id" | "createdAt">): ConvFile => {
    const entry: ConvFile = { ...file, id: uuidv4(), createdAt: Date.now() };
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, files: [...(c.files ?? []), entry], updatedAt: Date.now() } : c
    ));
    return entry;
  }, []);

  const removeConvFile = useCallback((convId: string, fileId: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, files: (c.files ?? []).filter(f => f.id !== fileId), updatedAt: Date.now() } : c
    ));
  }, []);

  const renameConvFile = useCallback((convId: string, fileId: string, newName: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, files: (c.files ?? []).map(f => f.id === fileId ? { ...f, name: newName } : f), updatedAt: Date.now() }
        : c
    ));
  }, []);

  const updateConvFile = useCallback((convId: string, fileId: string, content: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, files: (c.files ?? []).map(f => f.id === fileId ? { ...f, content, size: content.length } : f), updatedAt: Date.now() }
        : c
    ));
  }, []);

  return {
    workspaces, conversations, settings, activeWorkspaceId, activeConversationId,
    activeWorkspace, activeConversation, workspaceConversations, trashedConversations, archivedConversations,
    notifications,
    setActiveWorkspaceId, setActiveConversationId,
    createConversation, softDeleteConversation, restoreConversation, permanentDeleteConversation,
    archiveConversation, unarchiveConversation, duplicateConversation,
    updateConversation, addMessage, updateMessage, updateMessageWith, deleteMessage,
    setAgentStatus, addActivity,
    enqueueMessage, dequeueMessage, updateQueuedMessage, deleteQueuedMessage, reorderQueue, clearQueue,
    createWorkspace, updateWorkspace, deleteWorkspace, reorderWorkspaces,
    updateSettings, togglePin, toggleFavorite,
    addMemory, updateMemory, deleteMemory, toggleMemory,
    exportConversation, importConversation, saveDraft,
    pushNotification, markNotificationRead, clearNotifications,
    updateMcpServers,
addConvFile, removeConvFile, renameConvFile, updateConvFile,
  };
}
