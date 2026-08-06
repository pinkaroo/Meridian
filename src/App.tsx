import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react";
import { useAppStore } from "./stores/useAppStore";
import Sidebar from "./components/Sidebar";
import MessageRow from "./components/MessageRow";
import ModelPicker from "./components/ModelPicker";
import ChatInputBox from "./components/ChatInputBox";
import { LightboxProvider } from "./components/ImageLightbox";
import { runAgent, restoreToCheckpoint } from "./lib/agentRunner";
import GlobalSearch from "./components/GlobalSearch";
import InConvSearch from "./components/InConvSearch";
import SettingsModal from "./components/SettingsModal";
import WorkspaceModal from "./components/WorkspaceModal";
import CommandPalette from "./components/CommandPalette";
import AgentActivityPanel from "./components/AgentActivityPanel";
import { FileViewerPanel } from "./components/FileViewerPanel";
import WelcomeWalkthrough from "./components/WelcomeWalkthrough";
import { checkForUpdate, getBestAsset, isInstallerAsset, type UpdateInfo } from "./lib/updater";
import { applyTheme, getMode, getTheme } from "./lib/theme";
import type { Workspace, QueuedMessage, ApprovalRequest, Attachment, ShadcnTheme, ColorMode } from "./types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isBrowserModel } from "./lib/models";

function makeConversationTitle(text: string, attachmentName?: string) {
	const source = (text.trim() || attachmentName || "New conversation")
		.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ")
		.replace(/^["'`]+|["'`]+$/g, "").trim();
	if (!source) return "New conversation";
	if (attachmentName && !text.trim()) return attachmentName.replace(/\.[^.]+$/, "").slice(0, 48);
	let words = source.replace(/[.!?]+$/g, "").split(" ").filter(Boolean);
	words = words.filter((word, index) => {
		const normalized = word.toLowerCase().replace(/[^a-z0-9'-]/g, "");
		if (index < 3 && ["can", "could", "would", "please", "help", "i", "me", "hey", "hi", "just", "make", "fix", "add", "write", "show", "tell"].includes(normalized)) return false;
		return true;
	});
	const title = words.slice(0, 6).join(" ").slice(0, 48).trim();
	return title ? title.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : "New conversation";
}

function formatEstimatedCost(tokens: number) {
	const dollars = tokens * 0.00001;
	if (dollars === 0) return "$0";
	if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
	return `$${dollars.toFixed(2)}`;
}

function cleanAITitle(raw: string) {
	let title = raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").replace(/[<>\[\]{}]/g, "").trim();
	const repeated = title.match(/^(.{2,40})\1$/i);
	if (repeated) title = repeated[1].trim();
	if (/^(wait-for-results|read-file|read-file-range|run-command|tool|function|undefined|null)$/i.test(title)) return "New conversation";
	return title.slice(0, 60).trim() || "New conversation";
}
import {
Merge,
	Globe,
	Bot,
	MessageCircle,
	Pause,
	Square,
	Play,
	Zap,
	HelpCircle,
	FileText,
	X,
	ChevronDown,
	ListOrdered,
	Pencil,
	Trash2,
	GripVertical,
	Download,
	FolderOpen,
} from "lucide-react";

export default function App() {
	const store = useAppStore();
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const root = `${await appDataDir()}skills`;
				await invoke("ensure_default_skills", { targetRoot: root, overwrite: false });
				if (!cancelled && store.settings.skillsGlobalRoot !== root) {
					store.updateSettings({ skillsGlobalRoot: root });
				}
			} catch {
			}
		})();
		return () => { cancelled = true; };
	}, [store.settings.skillsGlobalRoot]);
	const lastNoticeStateRef = useRef<string | null>(null);
	useEffect(() => {
		let unlisten: (() => void) | null = null;
		(async () => {
			const { listen } = await import("@tauri-apps/api/event");
			unlisten = await listen<{ requestId: string; message: string }>("chat-notice", (e) => {
				const state = e.payload.message;
				if (state === lastNoticeStateRef.current) return;
				const prev = lastNoticeStateRef.current;
				lastNoticeStateRef.current = state;
				if (prev === null) return; // first observation, no toast
				if (state === "fallback") toast.warning("Switched to fallback endpoint", { description: "Main API unreachable, using backup." });
				else if (state === "primary") toast.success("Main API restored", { description: "Back on primary endpoint." });
			});
		})();
		return () => { try { unlisten?.(); } catch {} };
	}, []);
	const [showSettings, setShowSettings] = useState(false);
	const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
	const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
	const [editingWorkspace, setEditingWorkspace] = useState<Workspace | undefined>();
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [browserSetup, setBrowserSetup] = useState<{ model: string; convId: string; text: string; attachments?: Attachment[] } | null>(null);
	const [browserSetupError, setBrowserSetupError] = useState(false);
	useEffect(() => {
		if (!browserSetup) return;
		const provider = browserSetup.model.split(":")[1];
		const urls: Record<string, string> = { deepseek: "https://chat.deepseek.com/sign_in", gemini: "https://gemini.google.com/app", kimi: "https://www.kimi.com/login", glm: "https://chat.z.ai/auth", qwen: "https://chat.qwen.ai/auth", arena: "https://arena.ai/text/direct" };
		const url = urls[provider] ?? "about:blank";
		setBrowserSetupError(false);
		void invoke("browser_open_login", { provider, url }).catch(() => {
			const opened = window.open(url, "meridian-browser-login", "noopener");
			setBrowserSetupError(!opened);
		});
	}, [browserSetup]);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showActivityPanel, setShowActivityPanel] = useState(false);
	const [showFileViewer, setShowFileViewer] = useState(false);
	const [showGlobalSearch, setShowGlobalSearch] = useState(false);
	const [showInConvSearch, setShowInConvSearch] = useState(false);
	const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	const [updateDismissed, setUpdateDismissed] = useState(false);
	const [updateState, setUpdateState] = useState<"idle" | "downloading" | "launching">("idle");
	const [updateProgress, setUpdateProgress] = useState(0);
const [chatMode, setChatMode] = useState<"normal" | "merge" | "websearch">("normal");
	const [modeTab, setModeTab] = useState<"agent" | "chat">(() => {
		const saved = localStorage.getItem("meridian.modeTab");
		return saved === "chat" ? "chat" : "agent";
	});
	const lastConvByModeRef = useRef<{ agent: string | null; chat: string | null }>({ agent: null, chat: null });
	useEffect(() => {
		try {
			const raw = localStorage.getItem("meridian.lastConvByMode");
			if (raw) {
				const parsed = JSON.parse(raw);
				lastConvByModeRef.current = { agent: parsed.agent ?? null, chat: parsed.chat ?? null };
			}
		} catch {}
	}, []);
	const chatModeRef = useRef<"normal" | "merge" | "websearch">("normal");
	useEffect(() => { chatModeRef.current = chatMode; }, [chatMode]);
	function toggleMode(mode: "merge" | "websearch") {
		setChatMode(prev => prev === mode ? "normal" : mode);
	}
	const [showWelcome, setShowWelcome] = useState(() => {
		return !localStorage.getItem("meridian.welcomed");
	});
	const [visibleCount, setVisibleCount] = useState(50);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [elapsedTimes, setElapsedTimes] = useState<Record<string, number>>({});
	const startTimes = useRef<Map<string, number>>(new Map());
	const activeAssistantIds = useRef<Map<string, string>>(new Map());
	const [runningSet, setRunningSet] = useState<Set<string>>(new Set());

const messagesContainerRef = useRef<HTMLDivElement>(null);
	const storeRef = useRef(store);
	useEffect(() => { storeRef.current = store; });
	const [showScrollDown, setShowScrollDown] = useState(false);
	const autoFollowRef = useRef(true);
	const isWorkingRef = useRef(false);
	const abortControllers = useRef<Map<string, AbortController>>(new Map());
	const approvalResolvers = useRef<Map<string, (decision: "approved" | "denied") => void>>(new Map());

	const streamingDigest = useMemo(() => {
		const conv = store.activeConversation;
		if (!conv) return "";
		const msgs = conv.messages;
		if (!msgs || msgs.length === 0) return `empty:${conv.id}`;
		const last = msgs[msgs.length - 1];
		if (!last.streaming) return `done:${conv.id}:${msgs.length}:${last.content.length}`;
		const segLen = (last.segments ?? []).reduce((n, s) => {
			if (s.kind === "text" || s.kind === "thinking") return n + s.text.length;
			return n + 1;
		}, 0);
		return `live:${conv.id}:${msgs.length}:${last.content.length}:${segLen}`;
	}, [
		store.activeConversation?.id,
		store.activeConversation?.messages.length,
		store.activeConversation?.messages[store.activeConversation.messages.length - 1]?.content,
		store.activeConversation?.messages[store.activeConversation.messages.length - 1]?.streaming,
		store.activeConversation?.messages[store.activeConversation.messages.length - 1]?.segments,
	]);

	const handleScroll = useCallback(() => {
		const el = messagesContainerRef.current;
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		setShowScrollDown(distanceFromBottom > 80 && !autoFollowRef.current);
		if (distanceFromBottom < 40) {
			autoFollowRef.current = true;
		}
	}, []);

	useEffect(() => {
		const el = messagesContainerRef.current;
		if (!el) return;
		let touchStartY = 0;
		const onWheel = (e: WheelEvent) => {
			if (e.deltaY < 0) autoFollowRef.current = false;
		};
		const onTouchStart = (e: TouchEvent) => { touchStartY = e.touches[0]?.clientY ?? 0; };
		const onTouchMove = (e: TouchEvent) => {
			const y = e.touches[0]?.clientY ?? 0;
			if (y > touchStartY) autoFollowRef.current = false;
			touchStartY = y;
		};
		const onKey = (e: KeyboardEvent) => {
			if (["ArrowUp", "PageUp", "Home"].includes(e.key)) autoFollowRef.current = false;
		};
		el.addEventListener("wheel", onWheel, { passive: true });
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchmove", onTouchMove, { passive: true });
		el.addEventListener("keydown", onKey);
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchmove", onTouchMove);
			el.removeEventListener("keydown", onKey);
		};
	}, [store.activeConversationId]);

	useEffect(() => {
		if (!autoFollowRef.current) return;
		const el = messagesContainerRef.current;
		if (!el) return;
		const id = requestAnimationFrame(() => { if (autoFollowRef.current && messagesContainerRef.current) { messagesContainerRef.current.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: "smooth" }); } }); return () => cancelAnimationFrame(id);
	}, [streamingDigest]);

	useEffect(() => {
		const el = messagesContainerRef.current;
		if (!el) return;
		let rafId = 0;
		const observer = new MutationObserver(() => {
			if (!autoFollowRef.current) return;
			if (!isWorkingRef.current) return;
			if (rafId) return;
			rafId = requestAnimationFrame(() => {
				rafId = 0;
				if (autoFollowRef.current && messagesContainerRef.current) {
					messagesContainerRef.current.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: "smooth" });
				}
			});
		});
		observer.observe(el, { childList: true, subtree: true, characterData: true });
		return () => { observer.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
	}, [store.activeConversationId]);

	const scrollToBottom = useCallback((smooth = true) => {
		const el = messagesContainerRef.current;
		if (!el) return;
		autoFollowRef.current = true;
		if (smooth) {
			el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		} else {
			el.scrollTop = el.scrollHeight;
			autoFollowRef.current = true;
		}
		setShowScrollDown(false);
	}, []);

	useEffect(() => {
		autoFollowRef.current = true;
		setShowScrollDown(false);
		setVisibleCount(50);
		setLoadingOlder(false);
		requestAnimationFrame(() => {
			const el = messagesContainerRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		});
	}, [store.activeConversationId]);

useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowCommandPalette(v => !v); }
			if (e.key === "Escape") { setShowCommandPalette(false); setShowGlobalSearch(false); setShowInConvSearch(false); }
			if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); setShowCommandPalette(true); }
			if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
				const target = e.target as HTMLElement | null;
				if (!target || !["INPUT", "TEXTAREA"].includes(target.tagName)) {
					window.setTimeout(() => (document.querySelector("[data-chat-input]") as HTMLTextAreaElement | null)?.focus(), 0);
				}
			}
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
				e.preventDefault();
				setShowGlobalSearch(v => !v);
			}
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "f" || e.key === "F")) {
				const t = e.target as HTMLElement | null;
				if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
				e.preventDefault();
				setShowInConvSearch(v => !v);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		const theme: ShadcnTheme = (store.settings.theme as ShadcnTheme) ?? getTheme();
		applyTheme(theme, "dark");
	}, [store.settings.theme, store.settings.mode]);

	useEffect(() => {
		const timer = setTimeout(async () => {
			const info = await checkForUpdate();
			if (info) setUpdateInfo(info);
		}, 2000);
		return () => clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (runningSet.size === 0) return;
		const timer = window.setInterval(() => {
			setElapsedTimes(prev => {
				let changed = false;
				const next = { ...prev };
				runningSet.forEach(convId => {
					const start = startTimes.current.get(convId);
					const msgId = activeAssistantIds.current.get(convId);
					if (!start || !msgId) return;
					next[msgId] = Date.now() - start;
					changed = true;
				});
				return changed ? next : prev;
			});
		}, 250);
		return () => window.clearInterval(timer);
	}, [runningSet]);

	function markRunning(convId: string) {
		setRunningSet(prev => { const s = new Set(prev); s.add(convId); return s; });
	}
	function markDone(convId: string) {
		setRunningSet(prev => { const s = new Set(prev); s.delete(convId); return s; });
		abortControllers.current.delete(convId);
	}
	function finalizeElapsed(convId: string) {
		const start = startTimes.current.get(convId);
		const msgId = activeAssistantIds.current.get(convId);
		if (start && msgId) {
			const elapsedMs = Date.now() - start;
			setElapsedTimes(prev => ({ ...prev, [msgId]: elapsedMs }));
			store.updateMessageWith(convId, msgId, (message) => ({ ...message, elapsedMs }));
		}
		startTimes.current.delete(convId);
		activeAssistantIds.current.delete(convId);
	}

	const executeAgentRef = useRef<((convId: string, text: string, attachments?: Attachment[], mode?: "normal" | "merge" | "websearch", options?: { isContinuation?: boolean; continuePriorText?: string }) => Promise<void>) | null>(null);
	function drainQueue(convId: string, convTitle: string) {
		const next = store.dequeueMessage(convId);
		if (next) {
			setTimeout(() => executeAgentRef.current?.(convId, next.content, next.attachments), 80);
		} else {
			store.setAgentStatus(convId, "idle");
			store.pushNotification({ type: "agent_done", title: "Agent finished", body: convTitle, convId });
			if (store.settings.notifyOnDone && document.visibilityState === "hidden") {
				new Notification("Meridian", { body: "Agent finished responding" });
			}
		}
	}
	function getAbortController(convId: string): AbortController {
		const ctrl = new AbortController();
		abortControllers.current.set(convId, ctrl);
		return ctrl;
	}

	function resolvePendingApprovals(convId: string, decision: "approved" | "denied") {
		setPendingApprovals(prev => {
			const active = prev.filter(req => req.convId === convId);
			active.forEach(req => {
				approvalResolvers.current.get(req.id)?.(decision);
				approvalResolvers.current.delete(req.id);
			});
			return prev.filter(req => req.convId !== convId);
		});
	}

	function decideApproval(id: string, decision: "approved" | "denied") {
		approvalResolvers.current.get(id)?.(decision);
		approvalResolvers.current.delete(id);
		setPendingApprovals(prev => prev.filter(req => req.id !== id));
		const req = pendingApprovals.find(item => item.id === id);
		if (req) {
			store.addActivity(req.convId, {
				type: "approval",
				label: decision === "approved" ? `Approved: ${req.toolName}` : `Denied: ${req.toolName}`,
				detail: req.raw,
			});
		}
	}

	function openSettings(tab?: string) { setSettingsTab(tab); setShowSettings(true); }
function handleNewConversation(mode?: "agent" | "chat") {
		const useMode = mode ?? modeTab;
		const conv = store.createConversation(undefined, useMode);
		if (useMode === "agent" && store.activeWorkspaceId) {
			store.updateConversation(conv.id, { workspaceId: store.activeWorkspaceId });
		}
		setErrors({});
	}
	function handleSelectConversation(id: string) { store.setActiveConversationId(id); }
	function handleSelectWorkspace(id: string) { store.setActiveWorkspaceId(id); store.setActiveConversationId(null); }
	function handleModeTabChange(mode: "agent" | "chat") {
		const currentActive = store.activeConversationId;
		if (currentActive) {
			lastConvByModeRef.current = { ...lastConvByModeRef.current, [modeTab]: currentActive };
		}
		setModeTab(mode);
		try { localStorage.setItem("meridian.modeTab", mode); } catch {}
		try { localStorage.setItem("meridian.lastConvByMode", JSON.stringify(lastConvByModeRef.current)); } catch {}
		const lastId = lastConvByModeRef.current[mode];
		const restored = lastId ? storeRef.current.conversations.find(c => c.id === lastId && !c.deleted && !c.archived && (c.mode ?? "agent") === mode) : null;
		if (restored) {
			store.setActiveConversationId(restored.id);
		} else {
			store.setActiveConversationId(null);
		}
	}
	useEffect(() => {
		const active = store.activeConversation;
		if (active) {
			const m = active.mode ?? "agent";
			if (m !== modeTab) setModeTab(m);
			lastConvByModeRef.current = { ...lastConvByModeRef.current, [m]: active.id };
			try { localStorage.setItem("meridian.lastConvByMode", JSON.stringify(lastConvByModeRef.current)); } catch {}
		}
	}, [store.activeConversation?.id]);

	const handleBranch = useCallback((msgId: string) => {
		const conv = store.activeConversation;
		if (!conv) return;
		const idx = conv.messages.findIndex(m => m.id === msgId);
		if (idx < 0) return;
		const prefix = conv.messages.slice(0, idx + 1).map(m => ({ ...m, id: crypto.randomUUID() }));
		const branched = store.createConversation(conv.model);
		store.updateConversation(branched.id, {
			title: `Branch: ${conv.title}`.slice(0, 60),
			workspaceId: conv.workspaceId,
		});
		for (const m of prefix) store.addMessage(branched.id, m);
		requestAnimationFrame(() => store.setActiveConversationId(branched.id));
	}, [store]);

	const handleQuote = useCallback((msgId: string) => {
		const conv = store.activeConversation;
		if (!conv) return;
		const msg = conv.messages.find(m => m.id === msgId);
		if (!msg) return;
		const quoted = msg.content.split("\n").map(l => `> ${l}`).join("\n");
		requestAnimationFrame(() => {
			const fresh = store.conversations.find(c => c.id === conv.id);
			const existing = fresh?.draft ?? "";
			const sep = existing.trim() ? "\n\n" : "";
			store.saveDraft(conv.id, existing + sep + quoted + "\n\n");
			requestAnimationFrame(() => {
				const ta = document.querySelector("[data-chat-input]") as HTMLTextAreaElement | null;
				if (ta) {
					ta.focus();
					const len = ta.value.length;
					ta.setSelectionRange(len, len);
				}
			});
		});
	}, [store]);

	const executeAgent = useCallback(async (
		convId: string,
		text: string,
		attachments?: Attachment[],
		mode?: "normal" | "merge" | "websearch",
		options?: { isContinuation?: boolean; continuePriorText?: string; regenerateMessageId?: string }
) => {
const s = storeRef.current;
		const conv = s.conversations.find(c => c.id === convId);
		if (!conv) return;
		const executionConv = options?.regenerateMessageId
			? { ...conv, messages: conv.messages.filter(message => message.id !== options.regenerateMessageId) }
			: conv;
		const workspace = s.workspaces.find(w => w.id === conv.workspaceId);
		const activeMode = mode ?? "normal";

		markRunning(convId);
		startTimes.current.set(convId, Date.now());
		const ctrl = getAbortController(convId);
		store.setAgentStatus(convId, "working");

		if (activeMode === "merge") {
			const userMsg = {
				id: crypto.randomUUID(),
				role: "user" as const,
				content: text,
				timestamp: Date.now(),
				chatMode: "merge" as const,
				attachments: attachments && attachments.length > 0 ? attachments : undefined,
			};
			store.addMessage(convId, userMsg);

			const assistantId = crypto.randomUUID();
			const assistantMsg = {
				id: assistantId,
				role: "assistant" as const,
				content: "",
				timestamp: Date.now(),
				chatMode: "merge" as const,
				model: "Merge",
				streaming: true,
			};
			store.addMessage(convId, assistantMsg);
			activeAssistantIds.current.set(convId, assistantId);
			const startMs = startTimes.current.get(convId);
			if (startMs) {
				setElapsedTimes(prev => ({ ...prev, [assistantId]: Date.now() - startMs }));
			}

			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

			const { invoke } = await import("@tauri-apps/api/core");
			const { listen } = await import("@tauri-apps/api/event");

			let accumulated = "";
			const unlistenStatus = await listen<{ status?: string; phase?: string; mergePhase?: string; mergeProgress?: { completed: number; total: number; current?: string } }>(
				"merge://status",
				(e) => {
					const label = e.payload?.status || e.payload?.phase || e.payload?.mergePhase;
					if (label) {
						store.addActivity(convId, { type: "status_change", label: String(label) });
					}
				}
			);
			const unlistenDelta = await listen<{ text: string }>("merge://delta", (e) => {
				const piece = e.payload?.text ?? "";
				if (!piece) return;
				accumulated += piece;
				const snapshot = accumulated;
				store.updateMessageWith(convId, assistantId, (m) => ({
					...m,
					content: snapshot,
					segments: [{ kind: "text", text: snapshot }],
				}));
			});

			try {
				const result = await invoke<string>("chat_merge", { message: text });
				unlistenStatus();
				unlistenDelta();
				store.updateMessageWith(convId, assistantId, (m) => ({
					...m,
					content: result,
					segments: [{ kind: "text", text: result }],
					streaming: false,
				}));
				finalizeElapsed(convId);
				markDone(convId);
				drainQueue(convId, conv.title);
			} catch (err: any) {
				unlistenStatus();
				unlistenDelta();
				store.updateMessageWith(convId, assistantId, (m) => ({ ...m, streaming: false }));
				setErrors(prev => ({ ...prev, [convId]: String(err) }));
				finalizeElapsed(convId);
				markDone(convId);
				store.setAgentStatus(convId, "failed");
			}
			return;
		}

		if (activeMode === "websearch") {
			const userMsg = {
				id: crypto.randomUUID(),
				role: "user" as const,
				content: text,
				timestamp: Date.now(),
				chatMode: "websearch" as const,
				attachments: attachments && attachments.length > 0 ? attachments : undefined,
			};
			store.addMessage(convId, userMsg);

			const assistantId = crypto.randomUUID();
			const assistantMsg = {
				id: assistantId,
				role: "assistant" as const,
				content: "",
				timestamp: Date.now(),
				chatMode: "websearch" as const,
				model: "Web Search",
				streaming: true,
			};
			store.addMessage(convId, assistantMsg);
			activeAssistantIds.current.set(convId, assistantId);
			const startMs = startTimes.current.get(convId);
			if (startMs) {
				setElapsedTimes(prev => ({ ...prev, [assistantId]: Date.now() - startMs }));
			}

			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

			const { invoke } = await import("@tauri-apps/api/core");
			const { listen } = await import("@tauri-apps/api/event");

			const unlistenSurfStatus = await listen<{ status?: string; phase?: string; surfPhase?: string }>(
				"surf://status",
				(e) => {
					const label = e.payload?.status || e.payload?.phase || e.payload?.surfPhase;
					if (label) {
						store.addActivity(convId, { type: "status_change", label: String(label) });
					}
				}
			);

			try {
				const result = await invoke<{ answer: string; sources: Array<{ title: string; url: string; snippet: string }> }>(
					"chat_surf", { query: text }
				);
				unlistenSurfStatus();
				store.updateMessageWith(convId, assistantId, (m) => ({
					...m,
					content: result.answer || "I couldn't find a specific answer, but here are some sources I found.",
					searchSources: result.sources,
					streaming: false,
				}));
				finalizeElapsed(convId);
				markDone(convId);
				drainQueue(convId, conv.title);
			} catch (err: any) {
				unlistenSurfStatus();
				store.updateMessageWith(convId, assistantId, (m) => ({ ...m, streaming: false }));
				setErrors(prev => ({ ...prev, [convId]: String(err) }));
				finalizeElapsed(convId);
				markDone(convId);
				store.setAgentStatus(convId, "failed");
			}
			return;
		}

		await runAgent(executionConv, text, store.settings, ctrl.signal, {
			onStatusChange: (status) => {
				store.setAgentStatus(convId, status);
			},
			onMessageCreate: (msg) => {
				store.addMessage(convId, msg);
				if (msg.role === "assistant") {
					activeAssistantIds.current.set(convId, msg.id);
					const start = startTimes.current.get(convId);
					if (start) {
						setElapsedTimes(prev => ({ ...prev, [msg.id]: Date.now() - start }));
					}
				}
			},
			onMessageUpdate: (msgId, updater) => {
				store.updateMessageWith(convId, msgId, (m) => ({ ...m, ...updater(m) }));
			},
			onActivity: (ev) => store.addActivity(convId, ev),
			onMemoryAdded: (content) => {
				const entry = store.addMemory(content, "agent", conv.workspaceId, "agent");
				store.pushNotification({ type: "memory_saved", title: "Memory saved", body: content.slice(0, 80), convId });
				return entry.id;
			},
			onApprovalRequired: (request) => {
				const approval: ApprovalRequest = {
					...request,
					id: crypto.randomUUID(),
					convId,
					createdAt: Date.now(),
				};
				setPendingApprovals(prev => [...prev, approval]);
				store.pushNotification({ type: "approval_needed", title: "Approval needed", body: approval.title.slice(0, 80), convId });
				if (store.settings.notifyOnApproval && document.visibilityState === "hidden") {
					new Notification("Meridian approval needed", { body: approval.title });
				}
				return new Promise(resolve => {
					approvalResolvers.current.set(approval.id, resolve);
				});
			},
			onError: (err) => {
				const interruptedId = activeAssistantIds.current.get(convId);
				finalizeElapsed(convId);
				if (interruptedId) store.updateMessageWith(convId, interruptedId, (message) => ({ ...message, streaming: false, content: message.content?.trim() ? `${message.content}\n\n*Interrupted*` : "*Interrupted*", segments: undefined }));
				setErrors(prev => ({ ...prev, [convId]: err }));
				store.pushNotification({ type: "task_failed", title: "Agent failed", body: err.slice(0, 80), convId });
				markDone(convId);
				store.setAgentStatus(convId, "failed");
			},
onConsumeQueued: () => {
				const next = store.dequeueMessage(convId);
				if (!next) return null;
				return { content: next.content, attachments: next.attachments };
			},
			onConvFileAdded: (file) => {
				store.addConvFile(convId, {
					name: file.name,
					path: file.path,
					mimeType: file.mimeType,
					size: file.size,
					content: file.content,
					isBinary: file.isBinary,
					source: "agent",
				});
			},
			onConvFileRead: (name) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === name);
				if (!f) return null;
				return { content: f.content, mimeType: f.mimeType, isBinary: f.isBinary };
			},
			onConvFileUpdate: (name, content) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === name);
				if (!f) return false;
				store.updateConvFile(convId, f.id, content);
				return true;
			},
			onConvFileDelete: (name) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === name);
				if (!f) return false;
				store.removeConvFile(convId, f.id);
				return true;
			},
			onConvFileRename: (oldName, newName) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === oldName);
				if (!f) return false;
				store.renameConvFile(convId, f.id, newName);
				return true;
			},
			onConvFileList: () => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				return (c?.files ?? []).map(f => ({ name: f.name, size: f.size, mimeType: f.mimeType, source: f.source }));
			},
			onDone: () => {
				window.setTimeout(() => {
				const finished = storeRef.current.conversations.find((item) => item.id === convId);
				const firstUser = finished?.messages.find((message) => message.role === "user")?.content?.trim() ?? "";
				const firstAssistantMessage = finished?.messages.find((message) => message.role === "assistant" && message.content?.trim());
				const firstAssistant = firstAssistantMessage?.content?.trim() ?? "";
				const titleMarker = firstAssistant.match(/<!--\s*meridian-title:\s*([^>]{2,80})\s*-->/i) ?? firstAssistant.match(/\[\[MERIDIAN_TITLE:\s*([^\]]{2,80})\]\]/i);
				if (titleMarker && firstAssistantMessage) {
					const cleanTitle = cleanAITitle(titleMarker[1]);
					store.updateConversation(convId, { title: cleanTitle });
					store.updateMessageWith(convId, firstAssistantMessage.id, (message) => ({ ...message, content: message.content.replace(titleMarker[0], "").trim() }));
				} else if (firstAssistantMessage && firstUser) {
					const fallback = firstAssistant.split(/[.!?\n]/)[0].split(/\s+/).filter(Boolean).slice(0, 5).join(" ").replace(/[^\w\s'-]/g, "").trim();
					const cleanedFallback = cleanAITitle(fallback);
					if (cleanedFallback !== "New conversation" && cleanedFallback.length > 2) store.updateConversation(convId, { title: cleanedFallback.charAt(0).toUpperCase() + cleanedFallback.slice(1) });
				}
				if (firstUser.split(/\s+/).length <= 3 && /^(hi|hello|hey)\b/i.test(firstAssistant)) {
					store.updateConversation(convId, { title: "Greeting" });
				}
				}, 0);
				finalizeElapsed(convId);
				markDone(convId);
				setPendingApprovals(prev => prev.filter(req => req.convId !== convId));
				setErrors(prev => { const n = { ...prev }; delete n[convId]; return n; });
				drainQueue(convId, conv.title);
			},
		}, workspace, attachments, options, store.settings.mcpServers ?? []);
	}, [store]);

	const updateApprovalSettings = useCallback((mode: "ask" | "safe" | "full" = "ask") => {
		const approvals = mode === "full"
			? { requireRunCommand: false, requireFileWrite: false, requireFileDelete: false, requireNetworkRequest: false, requireEnvRead: false, requireFileRead: false }
			: { requireRunCommand: true, requireFileWrite: true, requireFileDelete: true, requireNetworkRequest: true, requireEnvRead: true, requireFileRead: false };
		store.updateSettings({ approvals });
		storeRef.current = { ...storeRef.current, settings: { ...storeRef.current.settings, approvals } };
	}, [store]);

useEffect(() => {
		executeAgentRef.current = executeAgent;
	}, [executeAgent]);

const handleSend = useCallback(async (text: string, attachments?: Attachment[]) => {
		if (!text.trim() && (!attachments || attachments.length === 0)) return;
		let conv = store.activeConversation;
		const isFreshConv = !conv;
		if (!conv) {
			conv = store.createConversation(undefined, modeTab);
			if (modeTab === "agent" && store.activeWorkspaceId) {
				store.updateConversation(conv.id, { workspaceId: store.activeWorkspaceId });
			}
store.setActiveConversationId(conv.id);
			storeRef.current = { ...storeRef.current, conversations: [...storeRef.current.conversations, conv] };
			autoFollowRef.current = true;
			requestAnimationFrame(() => {
				const el = messagesContainerRef.current;
				if (el) el.scrollTop = el.scrollHeight;
			});
		}
		const convId = conv.id;
		if (isBrowserModel(conv.model ?? store.settings.defaultModel) && localStorage.getItem(`meridian-browser:${conv.model}`) !== "ready") {
			store.setAgentStatus(convId, "paused");
			setBrowserSetup({ model: conv.model ?? store.settings.defaultModel, convId, text, attachments });
			return;
		}
		const wasEmpty = conv.messages.length === 0;

		if (wasEmpty) {
			const title = makeConversationTitle(text, attachments?.[0]?.name);
			store.updateConversation(convId, { title });
		}
		store.saveDraft(convId, "");
		setErrors(prev => { const n = { ...prev }; delete n[convId]; return n; });

		const modeToUse = chatModeRef.current;
		if (runningSet.has(convId)) {
			store.enqueueMessage(convId, text, attachments, modeToUse);
			return;
		}

		await executeAgent(convId, text, attachments, modeToUse);
	}, [store, executeAgent, runningSet, modeTab]);

	const handlePause = useCallback((convId: string) => {
		const ctrl = abortControllers.current.get(convId);
		ctrl?.abort();
		abortControllers.current.delete(convId);
		resolvePendingApprovals(convId, "denied");
		finalizeElapsed(convId);
		markDone(convId);
		store.setAgentStatus(convId, "paused");
	}, [store]);

	const handleStop = useCallback((convId: string) => {
		const ctrl = abortControllers.current.get(convId);
		ctrl?.abort();
		abortControllers.current.delete(convId);
		resolvePendingApprovals(convId, "denied");
		finalizeElapsed(convId);
		markDone(convId);
		store.setAgentStatus(convId, "idle");
		store.clearQueue(convId);
	}, [store]);

	const handleResume = useCallback(async (convId: string) => {
		const next = store.dequeueMessage(convId);
		if (next) {
			await executeAgent(convId, next.content, next.attachments);
			return;
		}
		store.setAgentStatus(convId, "idle");
	}, [store, executeAgent]);

	const handleContinue = useCallback(async (convId: string) => {
		if (runningSet.has(convId)) { store.enqueueMessage(convId, "Please continue."); return; }
		await executeAgent(convId, "Please continue.");
	}, [store, executeAgent, runningSet]);

	const handleRegenerate = useCallback(async (convId: string, msgId: string) => {
		const conv = store.conversations.find(c => c.id === convId);
		if (!conv) return;
		const msgIdx = conv.messages.findIndex(m => m.id === msgId);
		if (msgIdx <= 0) return;
		const userMsg = conv.messages[msgIdx - 1];
		if (userMsg.role !== "user") return;
		store.deleteMessage(convId, msgId);
		if (runningSet.has(convId)) { store.enqueueMessage(convId, userMsg.content); return; }
		await executeAgent(convId, userMsg.content, undefined, undefined, { regenerateMessageId: msgId });
	}, [store, executeAgent, runningSet]);

	const activeConv = store.activeConversation;
	const isWorking = activeConv ? runningSet.has(activeConv.id) : false;
	useEffect(() => { isWorkingRef.current = isWorking; }, [isWorking]);
	const agentStatus = activeConv?.agentStatus ?? "idle";
	const isPaused = agentStatus === "paused";
	const isWaitingApproval = agentStatus === "waiting_approval";
	const queue = activeConv?.queue ?? [];
	const activeApprovals = activeConv ? pendingApprovals.filter(req => req.convId === activeConv.id) : [];
	const messageCount = activeConv?.messages.length ?? 0;
	const bookmarkedCount = activeConv?.messages.filter(m => m.bookmarked).length ?? 0;
	const latestActivity = activeConv?.activity?.length
		? activeConv.activity[activeConv.activity.length - 1]
		: undefined;
	const toolRunCount = activeConv?.activity?.filter(a => ["tool_use", "file_modified", "command_exec"].includes(a.type)).length ?? 0;
	const attachmentCount = activeConv?.messages.reduce((sum, msg) => sum + (msg.attachments?.length ?? 0), 0) ?? 0;

	const statusBadgeClass = (() => {
		if (isWaitingApproval) return "bg-amber-500/10 text-amber-500 border-amber-500/30";
		if (isWorking) return "bg-sky-500/10 text-sky-500 border-sky-500/30";
		if (isPaused) return "bg-muted text-muted-foreground border-border";
		if (agentStatus === "failed") return "bg-destructive/10 text-destructive border-destructive/30";
		return "bg-muted text-muted-foreground border-border";
	})();

	const statusChipLabel = (() => {
		if (isWaitingApproval) return "needs approval";
		if (isWorking) return "working";
		if (isPaused) return "paused";
		if (agentStatus === "failed") return "failed";
		return "";
	})();

	useEffect(() => {
		if (activeApprovals.length === 0) return;
		const handler = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t) {
				const tag = t.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
			}
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const next = activeApprovals[0];
			if (!next) return;
			const k = e.key.toLowerCase();
			if (k === "y" || e.key === "Enter") {
				e.preventDefault();
				decideApproval(next.id, "approved");
			} else if (k === "n" || e.key === "Escape") {
				e.preventDefault();
				decideApproval(next.id, "denied");
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [activeApprovals]);

	const handleRestore = useCallback((result: { restored: number; errors: string[] }) => {
		const { restored, errors: errs } = result;
		if (errs.length === 0) {
			toast.success(`Restored ${restored} file${restored === 1 ? "" : "s"}`);
		} else if (restored > 0) {
			toast.warning(`Restored ${restored} file${restored === 1 ? "" : "s"}, ${errs.length} error${errs.length === 1 ? "" : "s"}`);
		} else {
			toast.error(`Restore failed: ${errs.length} error${errs.length === 1 ? "" : "s"}`);
		}
	}, []);

	return (
		<Suspense fallback={<div className="fixed inset-0 z-[9999] bg-background pt-11"><CustomTitleBar /><div className="flex h-full items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-label="Loading" /></div></div>}>
		<TooltipProvider delayDuration={300}>
			<div
				className={cn("opensail-shell relative flex h-screen w-screen overflow-hidden rounded-none border border-border/80 bg-background pt-11 text-foreground", store.settings.compactMode && "text-sm")}
				style={{ fontSize: store.settings.fontSize }}
			>
				<CustomTitleBar />
				{showWelcome && (
					<WelcomeWalkthrough onDone={() => {
						localStorage.setItem("meridian.welcomed", "1");
						setShowWelcome(false);
					}} />
				)}

<Sidebar
					modeTab={modeTab}
					onModeTabChange={handleModeTabChange}
					workspaces={store.workspaces}
					activeWorkspaceId={store.activeWorkspaceId}
					conversations={store.workspaceConversations}
					activeConversationId={store.activeConversationId}
					trashedConversations={store.trashedConversations}
					archivedConversations={store.archivedConversations}
					runningConvIds={runningSet}
					onSelectWorkspace={handleSelectWorkspace}
					onSelectConversation={handleSelectConversation}
					onNewConversation={handleNewConversation}
					onDeleteConversation={store.softDeleteConversation}
					onRenameConversation={(id, title) => store.updateConversation(id, { title })}
					onTogglePin={store.togglePin}
					onToggleFavorite={store.toggleFavorite}
					onArchiveConversation={store.archiveConversation}
					onUnarchiveConversation={store.unarchiveConversation}
					onDuplicateConversation={store.duplicateConversation}
					onExportConversation={(id) => {
						const json = store.exportConversation(id);
						const blob = new Blob([json], { type: "application/json" });
						const url = URL.createObjectURL(blob);
						const a = document.createElement("a"); a.href = url; a.download = "conversation.json"; a.click();
						URL.revokeObjectURL(url);
					}}
					onOpenSettings={openSettings}
					onCreateWorkspace={() => { setEditingWorkspace(undefined); setShowWorkspaceModal(true); }}
					onEditWorkspace={ws => { setEditingWorkspace(ws); setShowWorkspaceModal(true); }}
					onDeleteWorkspace={store.deleteWorkspace}
					onReorderWorkspaces={store.reorderWorkspaces}
					onRestoreConversation={store.restoreConversation}
					onPermanentDelete={store.permanentDeleteConversation}
					onOpenCommandPalette={() => setShowCommandPalette(true)}
				/>

				<div className="opensail-workspace app-panel flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
					{updateInfo && !updateDismissed && (
						<UpdateBanner
							info={updateInfo}
							state={updateState}
							progress={updateProgress}
							onInstall={async () => {
								const asset = getBestAsset(updateInfo.assets);
								const url = asset?.downloadUrl ?? updateInfo.releaseUrl;
								if (!asset) {
									try { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); } catch { window.open(url, "_blank"); }
									return;
								}
								setUpdateState("downloading");
								setUpdateProgress(0);
								const reqId = crypto.randomUUID();
								const { listen } = await import("@tauri-apps/api/event");
								const unlisten = await listen<{ requestId: string; percent: number }>("update-progress", e => {
									if (e.payload.requestId === reqId) setUpdateProgress(Math.round(e.payload.percent));
								});
								try {
									const { invoke } = await import("@tauri-apps/api/core");
									if (isInstallerAsset(asset)) {
										await invoke("download_and_run_installer", { requestId: reqId, url });
									} else {
										await invoke("download_and_run_update", { requestId: reqId, url });
									}
									unlisten();
									setUpdateState("launching");
									setTimeout(() => { setUpdateState("idle"); setUpdateDismissed(true); }, 3000);
								} catch {
									unlisten();
									setUpdateState("idle");
									try { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); } catch { window.open(url, "_blank"); }
								}
							}}
							onDismiss={() => setUpdateDismissed(true)}
						/>
					)}

					<header className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
						<div className="flex min-w-0 flex-1 items-center gap-3">
							<h1 className={cn("truncate text-sm font-semibold", !activeConv && "text-muted-foreground")}>
								{activeConv ? activeConv.title : store.activeWorkspace?.name ?? "Meridian"}
							</h1>
							{activeConv && statusChipLabel && (
								<Badge variant="outline" className={cn("h-5 px-1.5 text-[0.65rem] font-medium", statusBadgeClass)}>
									{statusChipLabel}
								</Badge>
							)}
							{activeConv && (
								<div className="flex items-center gap-3 text-xs text-muted-foreground">
									<span>{messageCount} messages</span>
									{bookmarkedCount > 0 && <span>{bookmarkedCount} saved</span>}
									{queue.length > 0 && <span>{queue.length} queued</span>}
								</div>
							)}
						</div>
						<div className="flex items-center gap-1.5">
							{activeConv && (
<>
									<ModelPicker
										value={activeConv.model ?? store.settings.defaultModel}
										onChange={model => store.updateConversation(activeConv.id, { model })}
									/>
									<ToggleGroup
										type="single"
										size="sm"
										value={chatMode === "normal" ? "" : chatMode}
										onValueChange={(v) => {
											if (v === "merge" || v === "websearch") toggleMode(v);
											else setChatMode("normal");
										}}
									>
										<ToggleGroupItem value="merge" className="h-8 gap-1 px-2 text-xs">
											<Merge className="h-3.5 w-3.5" />
											Merge
										</ToggleGroupItem>
										<ToggleGroupItem value="websearch" className="h-8 gap-1 px-2 text-xs">
											<Globe className="h-3.5 w-3.5" />
											Web
										</ToggleGroupItem>
									</ToggleGroup>
									{isWorking && (
										<>
											<Button size="sm" variant="outline" className="hidden h-8 gap-1 px-2 text-xs text-amber-500" onClick={() => handlePause(activeConv.id)}>
												<Pause className="h-3.5 w-3.5" />
												Pause
											</Button>
											<Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs text-destructive" onClick={() => handleStop(activeConv.id)}>
												<Square className="h-3.5 w-3.5" />
												Stop
											</Button>
										</>
									)}
									{isPaused && (
										<Button size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => handleResume(activeConv.id)}>
											<Play className="h-3.5 w-3.5" />
											Resume
										</Button>
									)}
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="ghost" size="icon" className={cn("h-8 w-8", showActivityPanel && "text-primary")} onClick={() => setShowActivityPanel(v => !v)}>
												<Zap className="h-4 w-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Activity</TooltipContent>
									</Tooltip>
								</>
							)}
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="ghost" size="icon" className={cn("relative h-8 w-8", showFileViewer && "text-primary")} onClick={() => setShowFileViewer(true)}>
										<FolderOpen className="h-4 w-4" />
										{(activeConv?.files?.length ?? 0) > 0 && (
											<span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[0.6rem] font-semibold text-background">
												{activeConv?.files?.length}
											</span>
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>Files ({activeConv?.files?.length ?? 0})</TooltipContent>
							</Tooltip>
						</div>
					</header>

					{activeConv && (
						<div className="mx-auto w-full max-w-[800px] px-6 pt-3">
							<AgentCockpit
								status={agentStatus}
								isWorking={isWorking}
								latestActivity={latestActivity}
								queueCount={queue.length}
								toolRunCount={toolRunCount}
								attachmentCount={attachmentCount}
								tokenCost={activeConv ? formatEstimatedCost(activeConv.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0)) : "$0"}
								instructionsActive={!!store.settings.instructions.trim()}
								onOpenActivity={() => setShowActivityPanel(true)}
								onOpenInstructions={() => openSettings("personalization")}
							/>
						</div>
					)}

					<div className="relative flex min-h-0 flex-1">
						<div
							ref={messagesContainerRef}
							onScroll={handleScroll}
							className="flex-1 overflow-y-auto"
						>
							{!activeConv || activeConv.messages.length === 0 ? (
								<div className="flex h-full items-center justify-center p-8">
									<div className="flex max-w-[560px] flex-col items-center gap-3 text-center">
										<HelpCircle className="h-14 w-14 text-primary opacity-80" />
										<h2 className="text-2xl font-semibold">What can I help with?</h2>
										<p className="text-sm text-muted-foreground">Agent ready. Ask anything.</p>
										{store.settings.instructions && (
											<div className="flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-500">
												<FileText className="h-3.5 w-3.5" />
												Custom instructions active
											</div>
										)}
										<p className="text-xs text-muted-foreground">
											<kbd className="mr-1 rounded border border-border px-1.5 py-0.5 font-mono text-[0.65rem]">Ctrl+K</kbd>
											Command palette
										</p>
										<PromptStarters onPick={handleSend} />
									</div>
								</div>
							) : (
								<div className="mx-auto w-full max-w-[800px] px-6 pb-4 pt-3">
									{activeConv.messages.length > visibleCount && (
									<div className="mb-3 flex justify-center">
										<Button
											variant="outline"
											size="sm"
											disabled={loadingOlder}
											onClick={() => {
												setLoadingOlder(true);
												setTimeout(() => {
													setVisibleCount(c => c + 50);
													setLoadingOlder(false);
												}, 200);
											}}
											className="h-8 gap-2 text-xs text-muted-foreground"
										>
											{loadingOlder ? (
												<>
													<span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
													Loading older messages...
												</>
											) : (
												<>Load {Math.min(50, activeConv.messages.length - visibleCount)} older messages</>
											)}
										</Button>
									</div>
								)}
								{activeConv.messages.slice(-visibleCount).map((msg, idx, arr) => (
										<MessageRow key={msg.id} message={msg} nickname={store.settings.nickname}
											elapsedMs={msg.role === "assistant" ? (elapsedTimes[msg.id] ?? msg.elapsedMs) : undefined}
											onEdit={(content) => store.updateMessage(activeConv.id, msg.id, { content, edited: true })}
											onDelete={() => store.deleteMessage(activeConv.id, msg.id)}
											onResend={() => { if (msg.role === "user") handleSend(msg.content); }}
											onRegenerate={() => handleRegenerate(activeConv.id, msg.id)}
											onContinue={() => handleContinue(activeConv.id)}
											onBookmark={() => store.updateMessage(activeConv.id, msg.id, { bookmarked: !msg.bookmarked })}
onMemoryClick={() => openSettings("personalization")}
											onBranch={() => handleBranch(msg.id)}
											onQuote={() => handleQuote(msg.id)}
											onRestoreCheckpoint={async (checkpointId) => {
												const result = await restoreToCheckpoint(msg.id, checkpointId);
												if (result.errors.length > 0) {
													setErrors(prev => ({ ...prev, [activeConv.id]: `Restore: ${result.errors.join("; ")}` }));
												}
												store.updateMessageWith(activeConv.id, msg.id, m => ({
													...m,
													segments: (m.segments ?? []).map(s =>
														s.kind === "checkpoint" && s.checkpointId === checkpointId
															? { ...s, restored: true }
															: s
													),
												}));
												handleRestore({ restored: result.restored.length, errors: result.errors });
											}}
											isLast={idx === arr.length - 1}
										/>
									))}
									{errors[activeConv.id] && (
										<div className="my-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
											<span className="flex-1">{errors[activeConv.id]}</span>
											<button
												type="button"
												onClick={() => setErrors(prev => { const n = { ...prev }; delete n[activeConv.id]; return n; })}
												className="shrink-0 rounded p-0.5 hover:bg-destructive/20"
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
									)}
									</div>
							)}
						</div>

						{showScrollDown && activeConv && activeConv.messages.length > 0 && (
							<Button
								size="icon"
								onClick={() => scrollToBottom(true)}
								aria-label="Scroll to bottom"
								className="absolute bottom-4 left-1/2 z-10 h-9 w-9 -translate-x-1/2 rounded-full shadow-sm"
								style={{ transform: "translateX(-50%)" }}
							>
								<ChevronDown className="h-4 w-4" />
							</Button>
						)}
						{activeConv && (
							<div className={cn(
								"absolute inset-y-3 right-4 z-30 w-[min(22rem,calc(100% - 2rem))] transition-[transform,opacity] duration-200 ease-out",
								showActivityPanel ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0",
							)}>
								<AgentActivityPanel activity={activeConv.activity ?? []} status={agentStatus} onClose={() => setShowActivityPanel(false)} />
							</div>
						)}
					</div>

					{activeApprovals.length > 0 && (
						<ApprovalPanel
							approvals={activeApprovals}
							onApprove={(id) => decideApproval(id, "approved")}
							onDeny={(id) => decideApproval(id, "denied")}
						/>
					)}

					{activeConv && queue.length > 0 && (
						<QueuePanel queue={queue}
							onEdit={(id, content) => store.updateQueuedMessage(activeConv.id, id, content)}
							onDelete={(id) => store.deleteQueuedMessage(activeConv.id, id)}
							onReorder={(from, to) => store.reorderQueue(activeConv.id, from, to)}
							onClearAll={() => store.clearQueue(activeConv.id)}
						/>
					)}

					<ChatInputBox onSend={handleSend} onStop={() => activeConv && handleStop(activeConv.id)} isWorking={isWorking} isWaitingApproval={isWaitingApproval} sendOnEnter={store.settings.sendOnEnter}
						onAskForApproval={updateApprovalSettings}
						draft={activeConv?.draft ?? ""} onDraftChange={(d) => activeConv && store.saveDraft(activeConv.id, d)}
						onAddConvFile={activeConv ? (f) => { store.addConvFile(activeConv.id, f); } : undefined}
						onImport={() => {
							const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
							input.onchange = (e) => {
								const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
								const reader = new FileReader();
								reader.onload = (ev) => store.importConversation(ev.target?.result as string);
								reader.readAsText(file);
							};
							input.click();
						}}
					/>
				</div>

				{showSettings && (
					<SettingsModal settings={store.settings} onUpdate={store.updateSettings} onClose={() => setShowSettings(false)}
						defaultTab={settingsTab} onAddMemory={store.addMemory} onUpdateMemory={store.updateMemory}
						onDeleteMemory={store.deleteMemory} onToggleMemory={store.toggleMemory} />
					)}
				{showWorkspaceModal && (
					<WorkspaceModal workspace={editingWorkspace}
						onSave={data => { if (editingWorkspace) store.updateWorkspace(editingWorkspace.id, data); else store.createWorkspace(data); }}
						onClose={() => setShowWorkspaceModal(false)}
						onDelete={editingWorkspace ? () => { store.deleteWorkspace(editingWorkspace.id); setShowWorkspaceModal(false); } : undefined} />
				)}
				{showCommandPalette && (
					<CommandPalette conversations={store.conversations.filter(c => !c.deleted)} workspaces={store.workspaces}
						settings={store.settings}
						activeConversationId={store.activeConversationId}
						onSelectModel={(modelId) => {
							if (store.activeConversationId) {
								store.updateConversation(store.activeConversationId, { model: modelId });
							}
							setShowCommandPalette(false);
						}}
						onClose={() => setShowCommandPalette(false)}
						onSelectConversation={(id) => { store.setActiveConversationId(id); setShowCommandPalette(false); }}
						onSelectWorkspace={(id) => { store.setActiveWorkspaceId(id); store.setActiveConversationId(null); setShowCommandPalette(false); }}
						onOpenSettings={(tab) => { openSettings(tab); setShowCommandPalette(false); }}
						onNewConversation={() => { handleNewConversation(); setShowCommandPalette(false); }} />
				)}
	{showGlobalSearch && (
					<Suspense fallback={null}>
						<GlobalSearch
							conversations={store.conversations.filter(c => !c.deleted)}
							onClose={() => setShowGlobalSearch(false)}
							onJump={(convId) => {
								store.setActiveConversationId(convId);
								setShowGlobalSearch(false);
							}}
						/>
					</Suspense>
				)}
				{showInConvSearch && activeConv && (
					<Suspense fallback={null}>
						<InConvSearch
							messages={activeConv.messages}
							onClose={() => setShowInConvSearch(false)}
							onJump={() => { /* no virtualization in stable build; native scroll handles it */ }}
						/>
					</Suspense>
				)}

				{activeConv && (
					<FileViewerPanel
						open={showFileViewer}
						onClose={() => setShowFileViewer(false)}
						files={activeConv.files ?? []}
						onDelete={(fileId) => store.removeConvFile(activeConv.id, fileId)}
						onRename={(fileId, newName) => store.renameConvFile(activeConv.id, fileId, newName)}
					/>
				)}

				{browserSetup && (
					<div className="fixed inset-0 z-[200] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="browser-setup-title" onClick={() => { setBrowserSetup(null); setBrowserSetupError(false); }}>
						<div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
							<h2 id="browser-setup-title" className="text-base font-semibold">Set up browser access</h2>
                            <p className="mt-2 text-sm text-muted-foreground">Sign in to the selected AI provider in Meridian's isolated browser session. Meridian never sees or stores your password.</p>
							{browserSetupError && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">Meridian could not start its dedicated browser profile. Install Chrome or Edge, then choose Retry.</p>}
							<div className="mt-5 flex justify-end gap-2">
								<Button variant="ghost" onClick={() => { setBrowserSetup(null); setBrowserSetupError(false); store.setAgentStatus(browserSetup.convId, "interrupted"); }}>No thanks</Button>
                                <Button variant="outline" onClick={() => { setBrowserSetupError(false); setBrowserSetup(current => current ? { ...current } : current); }}>Retry</Button>
                                <Button onClick={() => { localStorage.setItem(`meridian-browser:${browserSetup.model}`, "ready"); const pending = browserSetup; setBrowserSetup(null); setBrowserSetupError(false); void executeAgent(pending.convId, pending.text, pending.attachments); }}>I have signed in</Button>
							</div>
						</div>
					</div>
				)}

				<Toaster position="bottom-center" theme="dark" />
			</div>
		</TooltipProvider>
		</Suspense>
	);
}

function CustomTitleBar() {
	const run = async (action: "minimize" | "toggleMaximize" | "close") => {
		try {
			const win = getCurrentWindow();
			if (action === "minimize") await win.minimize();
			else if (action === "toggleMaximize") await win.toggleMaximize();
			else await win.close();
		} catch { /* browser preview has no native window controls */ }
	};
	return (
		<div className="absolute inset-x-0 top-0 z-50 flex h-11 items-center rounded-none border-b border-border/70 bg-background/95 px-3 backdrop-blur-xl" data-tauri-drag-region>
			<div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-foreground/80" data-tauri-drag-region>
				<span className="flex h-5 w-5 items-center justify-center rounded-md border border-primary/60 bg-primary/10 text-[10px] text-primary">M</span>
				<span className="truncate">Meridian</span>
			</div>
			<div className="absolute right-0 top-0 flex h-11 shrink-0 items-center gap-1">
				<button type="button" aria-label="Minimize window" className="flex h-11 w-12 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => run("minimize")}><span className="h-px w-3 bg-current" /></button>
				<button type="button" aria-label="Maximize window" className="flex h-11 w-12 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => run("toggleMaximize")}><span className="h-3 w-3 rounded-[3px] border border-current" /></button>
				<button type="button" aria-label="Close window" className="flex h-11 w-12 items-center justify-center rounded-none text-muted-foreground hover:bg-destructive hover:text-destructive-foreground" onClick={() => run("close")}><span className="relative h-3 w-3"><span className="absolute left-1.5 top-0 h-3 w-px rotate-45 bg-current" /><span className="absolute left-1.5 top-0 h-3 w-px -rotate-45 bg-current" /></span></button>
			</div>
		</div>
	);
}

function PromptStarters({ onPick }: { onPick: (text: string) => void }) {
	const prompts = [
		"Audit this project end-to-end: bugs, UX issues, missing tests, and quick wins.",
		"Make the current app feel premium: improve UI, empty states, motion, and ergonomics.",
		"Find the top 5 risky files, explain why, then fix the highest-impact issue.",
		"Add one useful power feature that fits the architecture and verify it works.",
		"Trace the main user workflow and remove friction points.",
		"Review recent changes like a senior engineer and patch anything suspicious.",
	];
	return (
		<div className="mt-1 flex w-full flex-col gap-1.5">
			{prompts.map(prompt => (
				<Button
					key={prompt}
					variant="outline"
					size="sm"
					onClick={() => onPick(prompt)}
					className="h-auto justify-start whitespace-normal py-2 text-left text-sm font-normal"
				>
					{prompt}
				</Button>
			))}
		</div>
	);
}

function AgentCockpit({ status, isWorking, latestActivity, queueCount, toolRunCount, attachmentCount, tokenCost, instructionsActive, onOpenActivity, onOpenInstructions }: {
	status: string;
	isWorking: boolean;
	latestActivity?: { type: string; label: string; detail?: string };
	queueCount: number;
	toolRunCount: number;
	attachmentCount: number;
	tokenCost: string;
	instructionsActive: boolean;
	onOpenActivity: () => void;
	onOpenInstructions: () => void;
}) {
	const statusLabel = isWorking ? "Live run" : status === "idle" ? "Ready" : status.replace("_", " ");
	const activityText = latestActivity?.label ?? "No agent activity yet";

	return (
		<div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<button
					type="button"
					onClick={onOpenActivity}
					className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent"
				>
					<span className={cn("h-2 w-2 rounded-full", isWorking ? "bg-sky-500 animate-pulse" : "bg-muted-foreground/50")} />
					<div className="text-left">
						<div className="text-xs font-semibold leading-tight">{statusLabel}</div>
						<div className="max-w-[26rem] truncate text-[0.65rem] leading-tight text-muted-foreground" title={activityText}>{activityText}</div>
					</div>
				</button>

				<Separator orientation="vertical" className="h-8" />

				<div className="flex min-w-0 flex-1 items-center gap-4 text-[0.7rem] text-muted-foreground">
					<span title="Tool actions in this conversation"><strong className="text-foreground">{toolRunCount}</strong> tools</span>
					<span title="Attached files in this conversation"><strong className="text-foreground">{attachmentCount}</strong> files</span>
					<span title="Queued follow-up messages"><strong className="text-foreground">{queueCount}</strong> queued</span>
					<span title="Estimated token cost"><strong className="text-foreground">{tokenCost}</strong> cost</span>
				</div>
			</div>

			<Button
				size="sm"
				variant={instructionsActive ? "default" : "outline"}
				onClick={onOpenInstructions}
				className="h-7 max-w-[230px] gap-1.5 overflow-hidden px-2.5 text-xs font-medium"
			>
				<FileText className="h-3.5 w-3.5" />
				User instructions: top priority
			</Button>
		</div>
	);
}

function ApprovalPanel({ approvals, onApprove, onDeny }: {
	approvals: ApprovalRequest[];
	onApprove: (id: string) => void;
	onDeny: (id: string) => void;
}) {
	const riskClass = (risk: string) => {
		if (risk === "high") return "bg-destructive/10 text-destructive border-destructive/30";
		if (risk === "medium") return "bg-amber-500/10 text-amber-500 border-amber-500/30";
		return "bg-sky-500/10 text-sky-500 border-sky-500/30";
	};
	const riskBorder = (risk: string) => {
		if (risk === "high") return "border-l-destructive";
		if (risk === "medium") return "border-l-amber-500";
		return "border-l-sky-500";
	};
	return (
		<div className="mx-3 my-2 rounded-md border border-l-[3px] border-l-amber-500 border-border bg-card p-3">
			<div className="mb-2 flex items-center justify-between">
				<div>
					<div className="text-[0.65rem] font-semibold uppercase tracking-wide text-amber-500">Action paused</div>
					<div className="text-sm font-semibold">
						{approvals.length === 1 ? "Approval required" : `${approvals.length} approvals required`}
					</div>
				</div>
				<span className="text-xs text-muted-foreground">Waiting for review</span>
			</div>
			<div className="flex flex-col gap-2">
				{approvals.map(req => (
					<div key={req.id} className={cn("rounded-md border border-l-[3px] border-border bg-background p-2.5", riskBorder(req.risk))}>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<div className="mb-1 flex items-center gap-1.5">
									<Badge variant="outline" className={cn("h-4 px-1.5 text-[0.6rem] font-semibold uppercase", riskClass(req.risk))}>
										{req.risk}
									</Badge>
									<span className="text-sm font-semibold">{req.title}</span>
								</div>
								{req.detail && <div className="mb-1 text-xs text-muted-foreground">{req.detail}</div>}
								<code className="mt-1 block overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 px-1.5 py-1 font-mono text-[0.7rem]">
									{req.raw}
								</code>
							</div>
							<div className="flex shrink-0 gap-1">
								<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onDeny(req.id)}>Deny</Button>
								<Button size="sm" className="h-7 px-2 text-xs" onClick={() => onApprove(req.id)}>Approve</Button>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function QueuePanel({ queue, onEdit, onDelete, onReorder, onClearAll }: {
	queue: QueuedMessage[]; onEdit: (id: string, content: string) => void;
	onDelete: (id: string) => void; onReorder: (from: number, to: number) => void; onClearAll: () => void;
}) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editVal, setEditVal] = useState("");
	const dragIdx = useRef<number | null>(null);

	return (
		<div className="mx-3 my-2 rounded-md border border-border bg-card p-2">
			<div className="mb-1 flex items-center justify-between px-1">
				<div className="flex items-center gap-1.5">
					<ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
						Queued Instructions ({queue.length})
					</span>
				</div>
				<Button variant="ghost" size="sm" onClick={onClearAll} className="h-6 px-2 text-xs">Clear all</Button>
			</div>
			<div className="flex flex-col">
				{queue.map((item, idx) => (
					<div
						key={item.id}
						draggable
						onDragStart={() => { dragIdx.current = idx; }}
						onDragOver={(e) => e.preventDefault()}
						onDragEnd={() => { dragIdx.current = null; }}
						onDrop={() => { if (dragIdx.current !== null && dragIdx.current !== idx) { onReorder(dragIdx.current, idx); dragIdx.current = null; } }}
						className="flex cursor-grab items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent/50"
					>
						<GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
						<span className="min-w-4 text-right text-xs text-muted-foreground">{idx + 1}</span>
						{editingId === item.id ? (
							<Input
								value={editVal}
								onChange={e => setEditVal(e.target.value)}
								onBlur={() => { onEdit(item.id, editVal); setEditingId(null); }}
								onKeyDown={e => { if (e.key === "Enter") { onEdit(item.id, editVal); setEditingId(null); } if (e.key === "Escape") setEditingId(null); }}
								autoFocus
								className="h-7 flex-1 text-sm"
							/>
						) : (
							<span
								onDoubleClick={() => { setEditingId(item.id); setEditVal(item.content); }}
								className="min-w-0 flex-1 truncate text-sm"
							>
								{item.content}
							</span>
						)}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingId(item.id); setEditVal(item.content); }}>
									<Pencil className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Edit</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => onDelete(item.id)}>
									<Trash2 className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Remove</TooltipContent>
						</Tooltip>
					</div>
				))}
			</div>
		</div>
	);
}

function UpdateBanner({
	info,
	state,
	progress,
	onInstall,
	onDismiss,
}: {
	info: UpdateInfo;
	state: "idle" | "downloading" | "launching";
	progress: number;
	onInstall: () => void;
	onDismiss: () => void;
}) {
	const isIdle = state === "idle";

	return (
		<div className="relative flex items-center gap-3 border-b border-border bg-primary px-4 py-2 text-primary-foreground">
			{state === "downloading" && (
				<Progress value={progress} className="absolute left-0 right-0 top-0 h-0.5 rounded-none bg-primary-foreground/20" />
			)}
			<Download className="h-4 w-4" />
			<span className="flex-1 text-sm font-medium">
				{state === "idle" && <>Update available: <strong>v{info.currentVersion}</strong> ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ <strong>v{info.latestVersion}</strong></>}
				{state === "downloading" && <>Downloading updateÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ {progress}%</>}
				{state === "launching" && <>Installing ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Meridian will restart automaticallyÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦</>}
			</span>
			{isIdle && (
				<div className="flex items-center gap-1">
					<Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={onInstall}>
						Install update
					</Button>
					<Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={onDismiss}>
						Not now
					</Button>
					<Button size="icon" variant="ghost" className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={onDismiss}>
						<X className="h-4 w-4" />
					</Button>
				</div>
			)}
			{!isIdle && (
				<span className="text-xs font-medium">
					{state === "downloading" ? "Please wait, do not close the app" : "Restarting shortlyÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦"}
				</span>
			)}
		</div>
	);
}
