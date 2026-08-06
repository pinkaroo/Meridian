import { memo, useState } from "react";
import type { ComponentType } from "react";
import {
	FileText,
	FilePen,
	FilePlus,
	Pencil,
	Trash2,
	FolderPlus,
	Copy,
	FolderInput,
	FileCheck,
	Info,
	AlignJustify,
	List,
	Search,
	Terminal,
	ExternalLink,
	BookmarkPlus,
	Wrench,
	ChevronDown,
	Loader2,
	Hourglass,
	Files,
	Hash,
	Replace,
	MapPin,
	FolderOpen,
	KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DiffView } from "./DiffView";
import type { ToolCallRecord } from "../types";

type IconType = ComponentType<{ className?: string }>;

const TOOL_ICONS: Record<string, IconType> = {
	"read-file": FileText,
	"read-file-range": AlignJustify,
	"read-multiple-files": Files,
	"write-file": FilePen,
	"append-file": FilePlus,
	"edit-file": Pencil,
	"replace-all-in-file": Replace,
	"delete-file": Trash2,
	"create-directory": FolderPlus,
	"copy-file": Copy,
	"move-file": FolderInput,
	"file-exists": FileCheck,
	"file-info": Info,
	"count-lines": Hash,
	"path-type": MapPin,
	"get-cwd": FolderOpen,
	"get-env": KeyRound,
	"list-directory": List,
	"search-files": Search,
	"run-command": Terminal,
	"fetch-url": ExternalLink,
	"memory-add": BookmarkPlus,
	"wait-for-results": Hourglass,
};

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function summarize(call: ToolCallRecord): string {
	const a = call.args;
	return a.path ?? a.paths ?? a.command ?? a.url ?? a.query ?? a.body?.slice(0, 80) ?? a.content?.slice(0, 80) ?? "";
}

function displayBody(value: string) {
	return value.replace(/<<<(?:FIND|REPLACE|END)>>>/g, "").trim();
}

const STATUS_ACCENT: Record<ToolCallRecord["status"], string> = {
	pending: "border-l-muted-foreground/40",
	running: "border-l-sky-500",
	complete: "border-l-emerald-500",
	error: "border-l-destructive",
	denied: "border-l-amber-500",
};

const STATUS_ICON_COLOR: Record<ToolCallRecord["status"], string> = {
	pending: "text-muted-foreground",
	running: "text-sky-500",
	complete: "text-emerald-500",
	error: "text-destructive",
	denied: "text-amber-500",
};

const STATUS_BADGE: Record<ToolCallRecord["status"], string> = {
	pending: "border-0 bg-transparent px-0 text-muted-foreground",
	running: "border-0 bg-transparent px-0 text-sky-400",
	complete: "border-0 bg-transparent px-0 text-emerald-400",
	error: "border-0 bg-transparent px-0 text-destructive",
	denied: "border-0 bg-transparent px-0 text-amber-400",
};

const STATUS_LABEL: Record<ToolCallRecord["status"], string> = {
	pending: "Waiting",
	running: "Running",
	complete: "Done",
	error: "Error",
	denied: "Denied",
};

function getDisplayName(name: string): string {
	if (name.startsWith("mcp__")) {
		const parts = name.split("__");
		const serverId = parts[1] ?? "";
		const toolName = parts.slice(2).join("__");
		const baseId = serverId.replace(/-\d{10,}$/, "");
		const serverLabel = baseId
			.split("-")
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" ");
		return `${serverLabel} Â· ${toolName}`;
	}
	const labels: Record<string, string> = {
		"run-command": "Ran",
		"write-file": "Edited",
		"append-file": "Edited",
		"edit-file": "Edited",
		"replace-all-in-file": "Edited",
		"read-file": "Read",
		"read-file-range": "Read",
		"list-directory": "Listed",
		"search-files": "Searched",
	};
	return labels[name] ?? name;
}

function getIcon(name: string): IconType {
	if (name.startsWith("mcp__")) return Wrench;
	return TOOL_ICONS[name] ?? Wrench;
}

function extractDiff(call: ToolCallRecord): { before: string; after: string; mode: "edit" | "write" | "append" } | null {
	const a = call.args;
	switch (call.name) {
		case "edit-file":
			if (typeof a.find !== "string" || typeof a.body !== "string") return null;
			return { before: displayBody(a.find), after: displayBody(a.body), mode: "edit" };
		case "replace-all-in-file":
			if (typeof a.find !== "string" || typeof a.body !== "string") return null;
			return { before: displayBody(a.find), after: displayBody(a.body), mode: "edit" };
		case "write-file":
			if (typeof a.body !== "string") return null;
			return { before: "", after: displayBody(a.body), mode: "write" };
		case "append-file":
			if (typeof a.body !== "string") return null;
			return { before: "", after: displayBody(a.body), mode: "append" };
		default:
			return null;
	}
}


function ToolCardImpl({ call }: { call: ToolCallRecord }) {
	const [open, setOpen] = useState(call.status === "error");

	const displayName = getDisplayName(call.name);
	const Icon = getIcon(call.name);
	const target = summarize(call);
	const duration = call.finishedAt ? call.finishedAt - call.startedAt : null;

	return (
		<div
			className={cn(
				"tool-row my-0 overflow-hidden bg-transparent",
			)}
		>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="no-press flex w-full items-center gap-2 px-1 py-1.5 text-left transition-colors hover:bg-accent/20"
			>
				<div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
					<span className={cn("shrink-0 text-sm font-medium", call.status === "running" && "shimmer-text")}>{displayName}</span>
					{target && (
						<span
							className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
							title={target}
						>
							{target}
						</span>
					)}
				</div>
				<Badge
					variant="outline"
					className={cn("h-5 shrink-0 gap-1 text-[0.65rem] font-medium", STATUS_BADGE[call.status])}
				>
					{call.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
					<span>{STATUS_LABEL[call.status]}</span>
				</Badge>
				{duration !== null && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(duration)}</span>
				)}
				<ChevronDown
					className={cn(
						"h-4 w-4 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
				/>
			</button>

			<div
				className={cn(
					"grid transition-all duration-200",
					open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="mt-1 px-1 py-2">
						{(() => {
							const diff = extractDiff(call);
							if (diff) {
								const pathArg = typeof call.args.path === "string" ? call.args.path : "";
								return (
									<div className="flex flex-col gap-1.5">
										{pathArg && (
											<div className="flex flex-col gap-0.5">
												<span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
													path
												</span>
								<pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1 font-mono text-xs">
									{displayBody(pathArg)}
												</pre>
											</div>
										)}
										<DiffView before={diff.before} after={diff.after} mode={diff.mode} />
									</div>
								);
							}
							if (Object.keys(call.args).length === 0) return null;
							return (
								<div className="flex flex-col gap-1">
									{Object.entries(call.args).map(([key, val]) => (
										<div key={key} className="flex flex-col gap-0.5">
											<span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
												{key}
											</span>
											<pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1 font-mono text-xs">
												{val}
											</pre>
										</div>
									))}
								</div>
							);
						})()}
						{call.result && (
							<div className="mt-2 flex flex-col gap-0.5">
								<span
									className={cn(
										"text-[0.65rem] font-semibold uppercase tracking-wide",
										call.status === "error" ? "text-destructive" : "text-muted-foreground",
									)}
								>
									{call.status === "error" ? "Error" : "Result"}
								</span>
								<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1 font-mono text-xs">
									{call.result}
								</pre>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export const ToolCard = memo(ToolCardImpl, (prev, next) => {
	const a = prev.call;
	const b = next.call;
	return (
		a.id === b.id &&
		a.status === b.status &&
		a.result === b.result &&
		a.startedAt === b.startedAt &&
		a.finishedAt === b.finishedAt &&
		a.args === b.args
	);
});


function aggregateStatus(calls: ToolCallRecord[]): ToolCallRecord["status"] {
	if (calls.some(c => c.status === "error")) return "error";
	if (calls.some(c => c.status === "running")) return "running";
	if (calls.some(c => c.status === "pending")) return "pending";
	if (calls.some(c => c.status === "denied")) return "denied";
	return "complete";
}

function ToolCardStackImpl({ calls }: { calls: ToolCallRecord[] }) {
	const [open, setOpen] = useState(false);

	if (calls.length === 1) {
		return <ToolCard call={calls[0]} />;
	}

	const active = calls.find((call) => call.status === "running" || call.status === "pending") ?? calls[calls.length - 1];
	const displayName = getDisplayName(active.name);
	const Icon = getIcon(active.name);
	const status = aggregateStatus(calls);

	const totalMs = calls.reduce((acc, c) => {
		if (c.finishedAt) return acc + (c.finishedAt - c.startedAt);
		return acc;
	}, 0);

	const completedCount = calls.filter(c => c.status === "complete").length;
	const errorCount = calls.filter(c => c.status === "error").length;

	const targets = calls.map(summarize).filter(Boolean);
	const targetPreview = targets.length > 0
		? targets.slice(0, 2).join(", ") + (targets.length > 2 ? `, +${targets.length - 2}` : "")
		: "";

	return (
		<div
			className={cn(
				"tool-row my-1 overflow-hidden bg-transparent",
				STATUS_ACCENT[status],
			)}
		>
			<button
				type="button"
				onClick={() => setOpen(o => !o)}
				className="no-press flex w-full items-center gap-2 px-1 py-1.5 text-left transition-colors hover:bg-accent/20"
			>
				<Icon className={cn("tool-row-icon h-3.5 w-3.5 shrink-0", STATUS_ICON_COLOR[status])} />
				<div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
					<span className={cn("shrink-0 text-sm font-medium", status === "running" && "shimmer-text")}>{displayName}</span>
					<Badge
						variant="outline"
						className="h-5 shrink-0 border-0 bg-transparent px-0 text-[0.65rem] font-medium tabular-nums text-muted-foreground"
						title={`${calls.length} calls`}
					>
						Ã—{calls.length}
					</Badge>
					{targetPreview && (
						<span
							className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
							title={targets.join("\n")}
						>
							{targetPreview}
						</span>
					)}
				</div>
				<Badge
					variant="outline"
					className={cn("h-5 shrink-0 gap-1 text-[0.65rem] font-medium", STATUS_BADGE[status])}
				>
					{status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
					<span>
						{status === "running"
							? `${completedCount}/${calls.length}`
							: errorCount > 0
								? `${errorCount} failed`
								: STATUS_LABEL[status]}
					</span>
				</Badge>
				{totalMs > 0 && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(totalMs)}</span>
				)}
				<ChevronDown
					className={cn(
						"h-4 w-4 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
				/>
			</button>

			<div
				className={cn(
					"grid transition-all duration-200",
					open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="flex flex-col gap-0 rounded-lg border border-border/60 bg-muted/20 px-1 py-1">
						{calls.map(call => (
							<ToolCard key={call.id} call={call} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export const ToolCardStack = memo(ToolCardStackImpl, (prev, next) => {
	if (prev.calls.length !== next.calls.length) return false;
	for (let i = 0; i < prev.calls.length; i++) {
		const a = prev.calls[i];
		const b = next.calls[i];
		if (
			a.id !== b.id ||
			a.status !== b.status ||
			a.result !== b.result ||
			a.startedAt !== b.startedAt ||
			a.finishedAt !== b.finishedAt ||
			a.args !== b.args
		) {
			return false;
		}
	}
	return true;
});
