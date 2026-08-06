import { useState, useRef, useEffect } from "react";
import type { Workspace, Conversation } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
	DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
	PanelLeft, Plus, Search, Settings as SettingsIcon, Pencil, Pin, Star, Home, Bot, Boxes, Workflow, FolderKanban, Store, Library,
	Copy, Download, Archive, Trash2, MessageSquare, MoreVertical, CheckSquare, Square, X,
} from "lucide-react";
import { workspaceIcon } from "../lib/workspaceIcons";

interface SidebarProps {
	modeTab: "agent" | "chat";
	onModeTabChange: (mode: "agent" | "chat") => void;
	workspaces: Workspace[];
	activeWorkspaceId: string;
	conversations: Conversation[];
	activeConversationId: string | null;
	trashedConversations: Conversation[];
	archivedConversations: Conversation[];
	runningConvIds: Set<string>;
	onSelectWorkspace: (id: string) => void;
	onSelectConversation: (id: string) => void;
	onNewConversation: (mode?: "agent" | "chat") => void;
	onDeleteConversation: (id: string) => void;
	onRenameConversation: (id: string, title: string) => void;
	onTogglePin: (id: string) => void;
	onToggleFavorite: (id: string) => void;
	onArchiveConversation: (id: string) => void;
	onUnarchiveConversation: (id: string) => void;
	onDuplicateConversation: (id: string) => void;
	onExportConversation: (id: string) => void;
	onOpenSettings: (tab?: string) => void;
	onCreateWorkspace: () => void;
	onEditWorkspace: (ws: Workspace) => void;
	onDeleteWorkspace: (id: string) => void;
	onReorderWorkspaces: (from: number, to: number) => void;
	onRestoreConversation: (id: string) => void;
	onPermanentDelete: (id: string) => void;
	onOpenCommandPalette: () => void;
}

export default function Sidebar({
	modeTab, onModeTabChange,
	workspaces, activeWorkspaceId, conversations, activeConversationId,
	trashedConversations, archivedConversations, runningConvIds,
	onSelectWorkspace, onSelectConversation, onNewConversation, onDeleteConversation,
	onRenameConversation, onTogglePin, onToggleFavorite, onArchiveConversation,
	onUnarchiveConversation, onDuplicateConversation, onExportConversation,
	onOpenSettings, onCreateWorkspace, onEditWorkspace,
	onReorderWorkspaces, onRestoreConversation, onPermanentDelete, onOpenCommandPalette,
}: SidebarProps) {
	const [search, setSearch] = useState("");
	const [showTrash, setShowTrash] = useState(false);
	const [showArchive, setShowArchive] = useState(false);
	const [renamingId, setRenamingId] = useState<string | null>(null);
const [renameVal, setRenameVal] = useState("");
	const [collapsed, setCollapsed] = useState(false);
	const wsDragIdx = useRef<number | null>(null);

	const [bulkMode, setBulkMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [showBulkRename, setShowBulkRename] = useState(false);
	const [bulkRenamePattern, setBulkRenamePattern] = useState("");
	const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

	function exitBulkMode() {
		setBulkMode(false);
		setSelectedIds(new Set());
	}

	function toggleSelect(id: string) {
		setSelectedIds(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function selectAll(ids: string[]) {
		setSelectedIds(new Set(ids));
	}

	function startRename(id: string, title: string) {
		setRenamingId(id);
		setRenameVal(title);
	}

	function commitRename(id: string) {
		if (renameVal.trim()) onRenameConversation(id, renameVal.trim());
		setRenamingId(null);
	}

	function cancelRename() {
		setRenamingId(null);
		setRenameVal("");
	}

	function formatTime(ts: number) {
		const d = Date.now() - ts;
		if (d < 60000) return "just now";
		if (d < 3600000) return Math.floor(d / 60000) + "m ago";
		if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
		return new Date(ts).toLocaleDateString();
	}

	function applyBulkDelete() {
		for (const id of selectedIds) onDeleteConversation(id);
		setShowBulkDeleteConfirm(false);
		exitBulkMode();
	}

	function applyBulkRename() {
		const pat = bulkRenamePattern.trim();
		if (!pat) { setShowBulkRename(false); return; }
		const ids = Array.from(selectedIds);
		ids.forEach((id, i) => {
			const conv = conversations.find(c => c.id === id);
			if (!conv) return;
			const newTitle = pat
				.replace(/\{n\}/g, String(i + 1))
				.replace(/\{title\}/g, conv.title)
				.slice(0, 80);
			if (newTitle) onRenameConversation(id, newTitle);
		});
		setBulkRenamePattern("");
		setShowBulkRename(false);
		exitBulkMode();
	}

	function applyBulkArchive() {
		for (const id of selectedIds) onArchiveConversation(id);
		exitBulkMode();
	}

	function applyBulkPin(pin: boolean) {
		for (const id of selectedIds) {
			const conv = conversations.find(c => c.id === id);
			if (!conv) continue;
			if (!!conv.pinned !== pin) onTogglePin(id);
		}
		exitBulkMode();
	}

const byMode = conversations.filter(c => (c.mode ?? "agent") === modeTab);
	const filtered = search
		? byMode.filter(c => c.title.toLowerCase().includes(search.toLowerCase()))
		: byMode;
	const pinned = filtered.filter(c => c.pinned);
	const favorited = filtered.filter(c => c.favorited && !c.pinned);
	const recent = filtered.filter(c => !c.pinned && !c.favorited);
	const allFilteredIds = filtered.map(c => c.id);
	const selectedCount = selectedIds.size;
	const allSelected = selectedCount > 0 && selectedCount === allFilteredIds.length;

	if (collapsed) {
		return (
			<TooltipProvider delayDuration={300}>
				<div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-card py-2">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCollapsed(false)}>
								<PanelLeft className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">Expand</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onNewConversation()}>
								<Plus className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">New chat</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenCommandPalette}>
								<Search className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">Command palette (Ctrl+K)</TooltipContent>
					</Tooltip>
					<Separator className="my-1 w-8" />
					<div className="flex flex-col gap-1.5">
						{workspaces.map(ws => {
							const WsIcon = workspaceIcon(ws.icon);
							return (
								<Tooltip key={ws.id}>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={() => onSelectWorkspace(ws.id)}
											className={cn(
												"flex h-8 w-8 items-center justify-center rounded-md transition-colors",
												ws.id === activeWorkspaceId && "ring-1 ring-primary",
											)}
											style={{ backgroundColor: ws.color }}
										>
											<WsIcon className="h-4 w-4 text-white" />
										</button>
									</TooltipTrigger>
									<TooltipContent side="right">{ws.name}</TooltipContent>
								</Tooltip>
							);
						})}
					</div>
					<div className="mt-auto">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenSettings()}>
									<SettingsIcon className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="right">Settings</TooltipContent>
						</Tooltip>
					</div>
				</div>
			</TooltipProvider>
		);
	}

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-r border-border bg-card">
				<div className="flex items-center justify-between px-3 py-2.5">
					<div className="flex items-center gap-2">
						<div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">M</div>
						<span className="text-sm font-semibold">Meridian</span>
					</div>
					<div className="flex gap-0.5">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className={cn("h-7 w-7", bulkMode && "text-primary")} onClick={() => bulkMode ? exitBulkMode() : setBulkMode(true)}>
									<CheckSquare className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>{bulkMode ? "Exit bulk mode" : "Select multiple"}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOpenCommandPalette}>
									<Search className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Command palette (Ctrl+K)</TooltipContent>
						</Tooltip>
<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onNewConversation(modeTab)}>
									<Plus className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>New {modeTab === "chat" ? "chat" : "agent"} conversation</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCollapsed(true)}>
									<PanelLeft className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Collapse</TooltipContent>
						</Tooltip>
					</div>
				</div>
				<nav className="hidden">
					{[
						["Home", Home], ["Agents", Bot], ["Apps", Boxes], ["Automations", Workflow],
						["Workspaces", FolderKanban], ["Marketplace", Store], ["Library", Library],
					].map(([label, Icon], index) => (
						<button
							key={label as string}
							type="button"
							onClick={() => {
								if (label === "Home") onNewConversation("chat");
								else if (label === "Agents" || label === "Workspaces") onModeTabChange("agent");
								else if (label === "Automations") onOpenSettings("tools");
								else if (label === "Marketplace") onOpenSettings("models");
								else if (label === "Library") onOpenSettings("skills");
								else onModeTabChange("chat");
							}}
							className={cn("flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/70", index === 1 && modeTab === "agent" ? "bg-primary/10 text-foreground" : "text-muted-foreground")}
						>
							<Icon className="h-4 w-4" />
							<span>{label as string}</span>
						</button>
					))}
				</nav>

<div className="px-3 pb-2">
					<div className="flex gap-1 rounded-md border border-border bg-muted/30 p-0.5">
						<button
							type="button"
							onClick={() => { onModeTabChange("agent"); exitBulkMode(); }}
							className={cn(
								"flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
								modeTab === "agent" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
							)}
						>
							Agent
						</button>
						<button
							type="button"
							onClick={() => { onModeTabChange("chat"); exitBulkMode(); }}
							className={cn(
								"flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
								modeTab === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
							)}
						>
							Chat
						</button>
						<button type="button" onClick={() => onOpenSettings("tools")} className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground" title="Configure RoCode extension">
							RoCode
						</button>
					</div>
				</div>
				<div className="px-3 pb-2">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search conversations..."
							value={search}
							onChange={e => setSearch(e.target.value)}
							className="h-8 pl-7 text-sm"
						/>
					</div>
				</div>

				{bulkMode && (
					<div className="mx-3 mb-2 rounded-md border border-primary/30 bg-primary/5 p-2">
						<div className="flex items-center justify-between gap-2">
							<button
								type="button"
								onClick={() => allSelected ? setSelectedIds(new Set()) : selectAll(allFilteredIds)}
								className="flex items-center gap-1.5 text-xs font-medium text-foreground"
							>
								{allSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
								{allSelected ? "Deselect all" : `Select all (${allFilteredIds.length})`}
							</button>
							<button
								type="button"
								onClick={exitBulkMode}
								className="rounded p-0.5 text-muted-foreground hover:text-foreground"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						</div>
						{selectedCount > 0 && (
							<div className="mt-2 space-y-1">
								<div className="text-[0.65rem] text-muted-foreground">{selectedCount} selected</div>
								<div className="flex flex-wrap gap-1">
									<Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setShowBulkRename(true)}>
										<Pencil className="mr-1 h-3 w-3" /> Rename
									</Button>
									<Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => applyBulkPin(true)}>
										<Pin className="mr-1 h-3 w-3" /> Pin
									</Button>
									<Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={applyBulkArchive}>
										<Archive className="mr-1 h-3 w-3" /> Archive
									</Button>
									<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive hover:text-destructive" onClick={() => setShowBulkDeleteConfirm(true)}>
										<Trash2 className="mr-1 h-3 w-3" /> Delete
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

{modeTab === "agent" && <div className="px-2 pb-2">
					<div className="flex items-center justify-between px-2 py-1">
						<span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Workspaces</span>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-5 w-5" onClick={onCreateWorkspace}>
									<Plus className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>New workspace</TooltipContent>
						</Tooltip>
					</div>
					<div className="flex flex-col gap-0.5">
						{workspaces.map((ws, idx) => {
							const WsIcon = workspaceIcon(ws.icon);
							const isActive = ws.id === activeWorkspaceId;
							return (
								<div
									key={ws.id}
									role="button"
									tabIndex={0}
									onClick={() => onSelectWorkspace(ws.id)}
									onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectWorkspace(ws.id); } }}
									onContextMenu={e => { e.preventDefault(); onEditWorkspace(ws); }}
									draggable
									onDragStart={() => { wsDragIdx.current = idx; }}
									onDragOver={e => e.preventDefault()}
									onDragEnd={() => { wsDragIdx.current = null; }}
									onDrop={() => { if (wsDragIdx.current !== null && wsDragIdx.current !== idx) { onReorderWorkspaces(wsDragIdx.current, idx); wsDragIdx.current = null; } }}
									className={cn(
										"group flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
										isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
									)}
								>
									<span
										className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
										style={{ backgroundColor: ws.color }}
									>
										<WsIcon className="h-3 w-3 text-white" />
									</span>
									<span className="flex-1 truncate text-sm">{ws.name}</span>
									{isActive && (
										<button
											type="button"
											onClick={e => { e.stopPropagation(); onEditWorkspace(ws); }}
											className="rounded p-0.5 text-muted-foreground hover:text-foreground"
										>
										<Pencil className="h-3 w-3" />
										</button>
									)}
								</div>
							);
})}
					</div>
				</div>}

				<Separator />

				<div className="flex-1 overflow-y-auto px-2 py-2">
					{pinned.length > 0 && (
						<div className="flex items-center gap-1 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
							<Pin className="h-2.5 w-2.5" /> Pinned
						</div>
					)}
					{pinned.map(c => (
						<ConvItem key={c.id} conv={c} active={c.id === activeConversationId}
							renamingId={renamingId} renameVal={renameVal} isRunning={runningConvIds.has(c.id)}
							bulkMode={bulkMode} selected={selectedIds.has(c.id)} onToggleSelect={() => toggleSelect(c.id)}
							onSelect={() => bulkMode ? toggleSelect(c.id) : onSelectConversation(c.id)}
							onStartRename={startRename}
							onCommitRename={commitRename} onCancelRename={cancelRename}
							onRenameChange={setRenameVal} formatTime={formatTime}
							onTogglePin={() => onTogglePin(c.id)}
							onToggleFavorite={() => onToggleFavorite(c.id)}
							onDuplicate={() => onDuplicateConversation(c.id)}
							onExport={() => onExportConversation(c.id)}
							onArchive={() => onArchiveConversation(c.id)}
							onDelete={() => onDeleteConversation(c.id)} />
					))}
					{favorited.length > 0 && (
						<div className={cn("flex items-center gap-1 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground", pinned.length > 0 && "mt-2")}>
							<Star className="h-2.5 w-2.5" /> Favorites
						</div>
					)}
					{favorited.map(c => (
						<ConvItem key={c.id} conv={c} active={c.id === activeConversationId}
							renamingId={renamingId} renameVal={renameVal} isRunning={runningConvIds.has(c.id)}
							bulkMode={bulkMode} selected={selectedIds.has(c.id)} onToggleSelect={() => toggleSelect(c.id)}
							onSelect={() => bulkMode ? toggleSelect(c.id) : onSelectConversation(c.id)}
							onStartRename={startRename}
							onCommitRename={commitRename} onCancelRename={cancelRename}
							onRenameChange={setRenameVal} formatTime={formatTime}
							onTogglePin={() => onTogglePin(c.id)}
							onToggleFavorite={() => onToggleFavorite(c.id)}
							onDuplicate={() => onDuplicateConversation(c.id)}
							onExport={() => onExportConversation(c.id)}
							onArchive={() => onArchiveConversation(c.id)}
							onDelete={() => onDeleteConversation(c.id)} />
					))}
					{recent.length > 0 && (pinned.length > 0 || favorited.length > 0) && (
						<div className="mt-2 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
							Recent
						</div>
					)}
					{recent.map(c => (
						<ConvItem key={c.id} conv={c} active={c.id === activeConversationId}
							renamingId={renamingId} renameVal={renameVal} isRunning={runningConvIds.has(c.id)}
							bulkMode={bulkMode} selected={selectedIds.has(c.id)} onToggleSelect={() => toggleSelect(c.id)}
							onSelect={() => bulkMode ? toggleSelect(c.id) : onSelectConversation(c.id)}
							onStartRename={startRename}
							onCommitRename={commitRename} onCancelRename={cancelRename}
							onRenameChange={setRenameVal} formatTime={formatTime}
							onTogglePin={() => onTogglePin(c.id)}
							onToggleFavorite={() => onToggleFavorite(c.id)}
							onDuplicate={() => onDuplicateConversation(c.id)}
							onExport={() => onExportConversation(c.id)}
							onArchive={() => onArchiveConversation(c.id)}
							onDelete={() => onDeleteConversation(c.id)} />
					))}
					{filtered.length === 0 && (
						<div className="flex flex-col items-center gap-1 py-8 text-muted-foreground">
							<MessageSquare className="h-4 w-4" />
							<span className="text-xs">{search ? "No results" : "No conversations yet"}</span>
						</div>
					)}
				</div>

				<Separator />

				<div className="p-3">
					<div className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">M</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold leading-tight">Meridian</div>
							<div className="truncate text-[0.65rem] text-muted-foreground">Local Agent</div>
						</div>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className={cn("relative h-7 w-7", archivedConversations.length > 0 ? "text-foreground" : "text-muted-foreground")} onClick={() => setShowArchive(true)}>
									<Archive className="h-3.5 w-3.5" />
									{archivedConversations.length > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
								</Button>
							</TooltipTrigger>
							<TooltipContent>Archive</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className={cn("relative h-7 w-7", trashedConversations.length > 0 ? "text-destructive" : "text-muted-foreground")} onClick={() => setShowTrash(true)}>
									<Trash2 className="h-3.5 w-3.5" />
									{trashedConversations.length > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive" />}
								</Button>
							</TooltipTrigger>
							<TooltipContent>Trash</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => onOpenSettings()}>
									<SettingsIcon className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Settings</TooltipContent>
						</Tooltip>
					</div>
				</div>

				<Dialog open={showBulkRename} onOpenChange={setShowBulkRename}>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle>Bulk rename {selectedCount} conversations</DialogTitle>
							<DialogDescription>
								Use <code className="rounded bg-muted px-1 text-xs">{"{n}"}</code> for index (1-based) and <code className="rounded bg-muted px-1 text-xs">{"{title}"}</code> for the original title.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-2 py-2">
							<Input
								placeholder="e.g. Research {n} - {title}"
								value={bulkRenamePattern}
								onChange={e => setBulkRenamePattern(e.target.value)}
								autoFocus
								onKeyDown={e => { if (e.key === "Enter") applyBulkRename(); }}
							/>
							{bulkRenamePattern.trim() && (
								<div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
									<div className="mb-1 font-semibold text-muted-foreground">Preview:</div>
									<div className="space-y-0.5 font-mono text-foreground">
										{Array.from(selectedIds).slice(0, 3).map((id, i) => {
											const conv = conversations.find(c => c.id === id);
											if (!conv) return null;
											const preview = bulkRenamePattern
												.replace(/\{n\}/g, String(i + 1))
												.replace(/\{title\}/g, conv.title)
												.slice(0, 80);
											return <div key={id} className="truncate">{preview}</div>;
										})}
										{selectedIds.size > 3 && <div className="text-muted-foreground">... and {selectedIds.size - 3} more</div>}
									</div>
								</div>
							)}
						</div>
						<DialogFooter>
							<Button variant="ghost" onClick={() => setShowBulkRename(false)}>Cancel</Button>
							<Button onClick={applyBulkRename} disabled={!bulkRenamePattern.trim()}>Rename</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle>Delete {selectedCount} conversations?</DialogTitle>
							<DialogDescription>
								They'll move to Trash and be permanently deleted after 30 days. You can restore them before then.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="ghost" onClick={() => setShowBulkDeleteConfirm(false)}>Cancel</Button>
							<Button variant="destructive" onClick={applyBulkDelete}>Move to Trash</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog open={showTrash} onOpenChange={setShowTrash}>
					<DialogContent className="max-w-lg">
						<DialogHeader>
							<DialogTitle>Trash</DialogTitle>
							<DialogDescription>Recently deleted conversations</DialogDescription>
						</DialogHeader>
						{trashedConversations.length > 0 && (
							<div className="flex items-center justify-between pb-2">
								<span className="text-xs text-muted-foreground">{trashedConversations.length} items</span>
								<Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => { trashedConversations.forEach(c => onPermanentDelete(c.id)); }}>
									<Trash2 className="mr-1 h-3 w-3" /> Empty trash
								</Button>
							</div>
						)}
						{trashedConversations.length === 0 ? (
							<div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
								<Trash2 className="h-8 w-8" />
								<span className="text-sm text-foreground">Trash is empty</span>
							</div>
						) : (
							<div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
								{trashedConversations.map(c => {
									const stamp = c.deletedAt ?? c.updatedAt;
									const daysLeft = Math.max(0, Math.ceil((stamp + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)));
									const urgent = daysLeft <= 3;
									const countdownLabel =
										daysLeft === 0 ? "Deleting today" :
										daysLeft === 1 ? "Deletion in 1 day" :
										`Deletion in ${daysLeft} days`;
									return (
										<div key={c.id} className="flex items-center justify-between rounded-md border border-border p-3">
											<div className="mr-4 min-w-0 flex-1">
												<div className="truncate text-sm font-semibold">{c.title}</div>
												<div className="mt-1 flex items-center gap-2">
													<span className="truncate text-xs text-muted-foreground">{formatTime(stamp)}</span>
													<span className={cn(
														"shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] font-medium",
														urgent
															? "border-destructive/30 bg-destructive/10 text-destructive"
															: "border-border bg-muted text-muted-foreground"
													)}>
														{countdownLabel}
													</span>
												</div>
											</div>
											<div className="flex gap-2">
												<Button size="sm" variant="outline" onClick={() => onRestoreConversation(c.id)}>Restore</Button>
												<Button size="sm" variant="ghost" className="text-destructive" onClick={() => onPermanentDelete(c.id)}>Delete forever</Button>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</DialogContent>
				</Dialog>

				<Dialog open={showArchive} onOpenChange={setShowArchive}>
					<DialogContent className="max-w-lg">
						<DialogHeader>
							<DialogTitle>Archive</DialogTitle>
							<DialogDescription>Hidden conversations</DialogDescription>
						</DialogHeader>
						{archivedConversations.length === 0 ? (
							<div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
								<Archive className="h-8 w-8" />
								<span className="text-sm text-foreground">Archive is empty</span>
							</div>
						) : (
							<div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
								{archivedConversations.map(c => (
									<div key={c.id} className="flex items-center justify-between rounded-md border border-border p-3">
										<div className="mr-4 min-w-0 flex-1">
											<div className="truncate text-sm font-semibold">{c.title}</div>
											<div className="truncate text-xs text-muted-foreground">{formatTime(c.updatedAt)}</div>
										</div>
										<div className="flex gap-2">
											<Button size="sm" variant="outline" onClick={() => onUnarchiveConversation(c.id)}>Unarchive</Button>
											<Button size="sm" variant="ghost" className="text-destructive" onClick={() => onPermanentDelete(c.id)}>Delete forever</Button>
										</div>
									</div>
								))}
							</div>
						)}
					</DialogContent>
				</Dialog>
			</div>
		</TooltipProvider>
	);
}

interface ConvItemProps {
	conv: Conversation;
	active: boolean;
	renamingId: string | null;
	renameVal: string;
	isRunning: boolean;
	bulkMode: boolean;
	selected: boolean;
	onToggleSelect: () => void;
	onSelect: () => void;
	onStartRename: (id: string, title: string) => void;
	onCommitRename: (id: string) => void;
	onCancelRename: () => void;
	onRenameChange: (v: string) => void;
	formatTime: (ts: number) => string;
	onTogglePin: () => void;
	onToggleFavorite: () => void;
	onDuplicate: () => void;
	onExport: () => void;
	onArchive: () => void;
	onDelete: () => void;
}

function ConvItem({ conv, active, renamingId, renameVal, isRunning, bulkMode, selected, onToggleSelect, onSelect, onStartRename, onCommitRename, onCancelRename, onRenameChange, formatTime, onTogglePin, onToggleFavorite, onDuplicate, onExport, onArchive, onDelete }: ConvItemProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	useEffect(() => {
		if (renamingId === conv.id) {
			const frame = requestAnimationFrame(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			});
			return () => cancelAnimationFrame(frame);
		}
		return undefined;
	}, [renamingId, conv.id]);

	const isRenaming = renamingId === conv.id;

	return (
		<div
			onClick={onSelect}
			onContextMenu={e => { if (!bulkMode) { e.preventDefault(); e.stopPropagation(); setMenuOpen(true); } }}
			className={cn(
				"group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
				active && !bulkMode ? "bg-accent" : "hover:bg-accent/50",
				bulkMode && selected && "bg-primary/10 ring-1 ring-primary/40",
			)}
		>
			{bulkMode ? (
				<button
					type="button"
					onClick={e => { e.stopPropagation(); onToggleSelect(); }}
					className="flex h-4 w-4 shrink-0 items-center justify-center"
				>
					{selected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}
				</button>
			) : (
				<div className="flex h-4 w-4 shrink-0 items-center justify-center">
					{isRunning ? (
						<span className="h-2 w-2 rounded-full bg-emerald-500" />
					) : conv.favorited ? (
						<Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
					) : (
						<MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
					)}
				</div>
			)}
			<div className="min-w-0 flex-1">
				{isRenaming ? (
					<input
						ref={inputRef}
						value={renameVal}
						onChange={e => onRenameChange(e.target.value)}
						onBlur={() => onCommitRename(conv.id)}
						onKeyDown={e => {
							if (e.key === "Enter") { e.stopPropagation(); onCommitRename(conv.id); }
							if (e.key === "Escape") { e.stopPropagation(); onCancelRename(); }
						}}
						onClick={e => e.stopPropagation()}
						className="w-full border-0 bg-transparent text-sm outline-none"
					/>
				) : (
					<div className="truncate text-sm">{conv.title}</div>
				)}
				<div className="truncate text-[0.65rem] text-muted-foreground">{formatTime(conv.updatedAt)}</div>
			</div>
			{!bulkMode && (
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							onClick={e => { e.stopPropagation(); setMenuOpen(true); }}
							className="rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
						>
							<MoreVertical className="h-3.5 w-3.5" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-40" onCloseAutoFocus={e => e.preventDefault()}>
						<DropdownMenuItem onClick={() => onStartRename(conv.id, conv.title)}>
							<Pencil className="mr-2 h-3.5 w-3.5" /> Rename
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onTogglePin}>
							<Pin className="mr-2 h-3.5 w-3.5" /> {conv.pinned ? "Unpin" : "Pin"}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onToggleFavorite}>
							<Star className={cn("mr-2 h-3.5 w-3.5", conv.favorited && "fill-current")} />
							{conv.favorited ? "Unfavorite" : "Favorite"}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onDuplicate}>
							<Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onExport}>
							<Download className="mr-2 h-3.5 w-3.5" /> Export
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={onArchive}>
							<Archive className="mr-2 h-3.5 w-3.5" /> Archive
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
							<Trash2 className="mr-2 h-3.5 w-3.5" /> Move to Trash
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}
