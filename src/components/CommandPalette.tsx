import { useState, useEffect, useRef, type ComponentType } from "react";
	import { Dialog, DialogContent } from "@/components/ui/dialog";
	import { Input } from "@/components/ui/input";
	import { Badge } from "@/components/ui/badge";
	import { cn } from "@/lib/utils";
	import { Search, MessageSquare, Cpu, Settings, Plus } from "lucide-react";
	import type { Conversation, Workspace, AppSettings } from "../types";
	import { MODELS } from "../lib/models";
	import { workspaceIcon } from "../lib/workspaceIcons";

	interface Props {
		conversations: Conversation[];
		workspaces: Workspace[];
		settings: AppSettings;
		activeConversationId?: string | null;
		onSelectModel?: (modelId: string) => void;
		onClose: () => void;
		onSelectConversation: (id: string) => void;
		onSelectWorkspace: (id: string) => void;
		onOpenSettings: (tab?: string) => void;
		onNewConversation: () => void;
	}

	interface PaletteItem {
		id: string;
		type: "conversation" | "workspace" | "model" | "setting" | "command";
		label: string;
		sublabel?: string;
		wsEmoji?: string;
		action: () => void;
	}

	const TYPE_CLASSES: Record<string, string> = {
		conversation: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
		workspace: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
		model: "bg-violet-500/10 text-violet-400 border-violet-500/30",
		setting: "bg-amber-500/10 text-amber-400 border-amber-500/30",
		command: "bg-sky-500/10 text-sky-400 border-sky-500/30",
	};

	type IconType = ComponentType<{ className?: string }>;

	export default function CommandPalette({
		conversations, workspaces, activeConversationId, onSelectModel,
		onClose, onSelectConversation, onSelectWorkspace, onOpenSettings, onNewConversation,
	}: Props) {
		const [query, setQuery] = useState("");
		const [selected, setSelected] = useState(0);
		const listRef = useRef<HTMLDivElement>(null);

		const allItems: PaletteItem[] = [
			{ id: "new-conv", type: "command", label: "New Conversation", action: onNewConversation },
			{ id: "settings-general", type: "setting", label: "Settings: General", action: () => onOpenSettings("general") },
			{ id: "settings-personalization", type: "setting", label: "Settings: Personalization", action: () => onOpenSettings("personalization") },
			{ id: "settings-models", type: "setting", label: "Settings: Models", action: () => onOpenSettings("models") },
			{ id: "settings-tools", type: "setting", label: "Settings: Tools & Approvals", action: () => onOpenSettings("tools") },
			...workspaces.map((ws) => ({
				id: `ws-${ws.id}`,
				type: "workspace" as const,
				label: ws.name,
				sublabel: "Workspace",
				wsEmoji: ws.icon,
				action: () => onSelectWorkspace(ws.id),
			})),
			...conversations
				.filter((c) => !c.deleted && !c.archived)
				.map((c) => ({
					id: `conv-${c.id}`,
					type: "conversation" as const,
					label: c.title,
					sublabel: "Conversation",
					action: () => onSelectConversation(c.id),
				})),
			...MODELS.map((m) => ({
				id: `model-${m.id}`,
				type: "model" as const,
				label: activeConversationId && onSelectModel ? `Use ${m.name}` : m.name,
				sublabel: `Model Â· ${m.tag}`,
				action: () => {
					if (activeConversationId && onSelectModel) onSelectModel(m.id);
					else onOpenSettings("models");
				},
			})),
		];

		const filtered = query.trim()
			? allItems.filter(
					(item) =>
						item.label.toLowerCase().includes(query.toLowerCase()) ||
						item.sublabel?.toLowerCase().includes(query.toLowerCase())
				)
			: allItems.slice(0, 12);

		useEffect(() => { setSelected(0); }, [query]);

		useEffect(() => {
			const el = listRef.current?.children[selected] as HTMLElement | undefined;
			el?.scrollIntoView({ block: "nearest" });
		}, [selected]);

		function handleKey(e: React.KeyboardEvent) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelected((s) => Math.min(s + 1, filtered.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelected((s) => Math.max(s - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				filtered[selected]?.action();
				onClose();
			}
		}

		function renderIcon(item: PaletteItem) {
			if (item.type === "workspace" && item.wsEmoji) {
				const WsIcon = workspaceIcon(item.wsEmoji);
				return <WsIcon className="h-4 w-4" />;
			}
			const Icon: IconType =
				item.type === "conversation" ? MessageSquare :
				item.type === "model" ? Cpu :
				item.type === "setting" ? Settings :
				Plus;
			return <Icon className="h-4 w-4" />;
		}

		return (
			<Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
				<DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
					<div className="border-b border-border p-2">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								autoFocus
								placeholder="Search chats, workspaces, models, settingsâ€¦"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={handleKey}
								className="h-9 border-0 pl-9 shadow-none focus-visible:ring-0"
							/>
							
						</div>
					</div>

					<div className="max-h-[55vh] overflow-y-auto">
						{filtered.length === 0 ? (
							<div className="py-8 text-center text-sm text-muted-foreground">
								No results for "{query}"
							</div>
						) : (
							<div ref={listRef} className="p-1">
								{filtered.map((item, idx) => (
									<button
										key={item.id}
										type="button"
										onClick={() => { item.action(); onClose(); }}
										onMouseEnter={() => setSelected(idx)}
										className={cn(
											"flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left transition-colors",
											idx === selected && "bg-accent",
										)}
									>
										<span className="text-muted-foreground">{renderIcon(item)}</span>
										<span className="flex-1 truncate text-sm">{item.label}</span>
										{item.sublabel && (
											<Badge variant="outline" className={cn("h-5 px-1.5 text-[0.65rem] font-medium", TYPE_CLASSES[item.type])}>
												{item.sublabel}
											</Badge>
										)}
									</button>
								))}
							</div>
						)}
					</div>

					<div className="flex items-center gap-4 border-t border-border bg-muted/30 px-3 py-2">
						{[
							{ k: "â†‘â†“", t: "navigate" },
							{ k: "â†µ", t: "select" },
							{ k: "Esc", t: "close" },
						].map((h) => (
							<div key={h.k} className="flex items-center gap-1.5">
								<kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[0.6rem]">{h.k}</kbd>
								<span className="text-[0.65rem] text-muted-foreground">{h.t}</span>
							</div>
						))}
					</div>
				</DialogContent>
			</Dialog>
		);
	}
