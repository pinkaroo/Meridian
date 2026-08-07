import { memo, useState, useRef, useEffect, useMemo } from "react";
	import { Button } from "@/components/ui/button";
	import { Textarea } from "@/components/ui/textarea";
	import { Badge } from "@/components/ui/badge";
	import { Separator } from "@/components/ui/separator";
	import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
	import { cn } from "@/lib/utils";
	import {
		Pencil, RefreshCw, Bookmark, BookmarkPlus, Trash2, Copy, Check,
		ChevronsRight, Clock, Merge, Search, Brain, Paperclip, History, RotateCcw,
		GitBranch, Quote, X, ChevronDown,
	} from "lucide-react";
	import MarkdownRenderer from "./MarkdownRenderer";
	import { languageFromName } from "../lib/languageFromName";
	import { useLightbox } from "./ImageLightbox";
	import StreamingTextV2 from "./StreamingTextV2";
	import ThinkingBlock from "./ThinkingBlock";
	import { ToolCard, ToolCardStack } from "./ToolCard";
	import type { Attachment, Message, MessageSegment, ToolCallRecord } from "../types";

	interface MessageRowProps {
		message: Message;
		nickname?: string;
		isLast?: boolean;
		elapsedMs?: number;
		onEdit: (content: string) => void;
		onDelete: () => void;
		onResend: () => void;
		onRegenerate: () => void;
		onContinue: () => void;
onBookmark: () => void;
		onMemoryClick: () => void;
		onRestoreCheckpoint?: (checkpointId: string) => void;
		onBranch?: () => void;
		onQuote?: () => void;
	}

	function formatElapsed(ms: number): string {
		if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
	}

function toolLabel(call: ToolCallRecord) {
	const labels: Record<string, string> = { "run-command": "Ran a command", "edit-file": "Edited a file", "write-file": "Edited a file", "append-file": "Edited a file", "read-file": "Read a file", "read-file-range": "Read a file", "list-directory": "Listed a directory", "search-files": "Searched files" };
	if (labels[call.name]) return labels[call.name];
	const readable = call.name.replace(/^mcp__[^_]+__/, "").replace(/[-_]+/g, " ").trim();
	return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : "Used a tool";
}

function toolTarget(call: ToolCallRecord) {
	const value = call.args.path ?? call.args.command ?? call.args.query ?? call.args.url;
	return typeof value === "string" ? value : "";
}

function MessageRowImpl({
		message, isLast, elapsedMs,
		onEdit, onDelete, onResend, onRegenerate, onContinue, onBookmark, onMemoryClick, onRestoreCheckpoint,
		onBranch, onQuote,
	}: MessageRowProps) {
		const [copied, setCopied] = useState(false);
		const [editing, setEditing] = useState(false);
		const [activityOpen, setActivityOpen] = useState(false);
		useEffect(() => { if (message.streaming) setActivityOpen(true); }, [message.streaming]);
		const [editVal, setEditVal] = useState(message.content);
		const editRef = useRef<HTMLTextAreaElement>(null);
		const isUser = message.role === "user";

		useEffect(() => {
			if (!editing) setEditVal(message.content);
		}, [message.content, editing]);

		useEffect(() => {
			if (editing && editRef.current) {
				editRef.current.focus();
				editRef.current.style.height = "auto";
				editRef.current.style.height = editRef.current.scrollHeight + "px";
			}
		}, [editing]);

		function copy() {
			navigator.clipboard.writeText(message.content.replace(/<!--\s*meridian-title:[\s\S]*?-->/gi, "").replace(/\[\[MERIDIAN_TITLE:[\s\S]*?\]\]/gi, "").trim());
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}

		function commitEdit() {
			if (editVal.trim() && editVal !== message.content) onEdit(editVal.trim());
			setEditing(false);
		}

		const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		const wordCount = useMemo(() => {
			if (isUser || message.streaming) return 0;
			return message.content.trim().split(/\s+/).filter(Boolean).length;
		}, [isUser, message.streaming, message.content]);
		const hasVisibleAssistantContent =
			message.content.trim().length > 0 ||
			(message.segments ?? []).some(segment =>
				segment.kind === "text" ? segment.text.trim().length > 0 :
				segment.kind === "thinking" ? segment.text.trim().length > 0 :
				true
			);
		const activitySegments = useMemo(() => (message.segments ?? []).filter((segment) => segment.kind === "thinking" || segment.kind === "checkpoint" || (segment.kind === "tool" && segment.call.name !== "wait-for-results")), [message.segments]);
		const displayContent = message.content
			.replace(/\[PRESENT-FILE[\s\S]*?\[\/PRESENT-FILE\]/gi, "")
			.replace(/<!--\s*meridian-title:[\s\S]*?-->/gi, "")
			.replace(/\[\[MERIDIAN_TITLE:[\s\S]*?\]\]/gi, "")
			.trim();
		const shouldShowTiming = elapsedMs !== undefined && hasVisibleAssistantContent && elapsedMs >= 500 && activitySegments.length > 0;
		const groupedActivity = useMemo(() => {
			const result: Array<MessageSegment | { kind: "tool-group"; calls: ToolCallRecord[] }> = [];
			for (const segment of activitySegments) {
				if (segment.kind !== "tool") { result.push(segment); continue; }
				const previous = result[result.length - 1];
				if (previous?.kind === "tool-group" && previous.calls[0]?.name === segment.call.name) previous.calls.push(segment.call);
				else result.push({ kind: "tool-group", calls: [segment.call] });
			}
			return result;
		}, [activitySegments]);

		if (!isUser && !message.streaming && !hasVisibleAssistantContent) {
			return null;
		}

		if (isUser) {
			return (
<TooltipProvider delayDuration={300}>
					<div className="group my-3 flex min-w-0 flex-col items-end">
						<div className="flex w-full min-w-0 max-w-[80%] flex-col items-end">
							{editing ? (
								<div className="w-full">
									<Textarea
										ref={editRef}
										value={editVal}
										onChange={e => {
											setEditVal(e.target.value);
											const el = e.target as HTMLTextAreaElement;
											el.style.height = "auto";
											el.style.height = el.scrollHeight + "px";
										}}
										onKeyDown={e => {
											if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
											if (e.key === "Escape") { setEditing(false); setEditVal(message.content); }
										}}
										className="min-h-[60px] resize-none"
										autoFocus
									/>
									<div className="mt-1.5 flex justify-end gap-1.5">
										<Button size="sm" onClick={commitEdit}>Save</Button>
										<Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditVal(message.content); }}>Cancel</Button>
									</div>
								</div>
							) : (
								<>
									{message.attachments && message.attachments.length > 0 && <AttachmentStrip attachments={message.attachments} />}
									{message.content && <div className="select-text whitespace-pre-wrap break-words overflow-wrap-anywhere rounded-2xl rounded-br-md border border-border bg-card px-4 py-2.5 text-[15px] leading-relaxed" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>{message.content}</div>}
								</>
							)}
							<div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
								<span className="mr-1 text-[0.7rem] text-muted-foreground">
									{time}{message.edited && " · edited"}
								</span>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditing(true); setEditVal(message.content); }}>
											<Pencil className="h-3 w-3" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Edit</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onResend}>
											<RefreshCw className="h-3 w-3" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Resend</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="ghost" size="icon" className={cn("h-6 w-6", message.bookmarked && "text-amber-500")} onClick={onBookmark}>
											{message.bookmarked ? <Bookmark className="h-3 w-3 fill-current" /> : <BookmarkPlus className="h-3 w-3" />}
										</Button>
									</TooltipTrigger>
									<TooltipContent>{message.bookmarked ? "Remove bookmark" : "Bookmark"}</TooltipContent>
								</Tooltip>
{onQuote && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onQuote}>
												<Quote className="h-3 w-3" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Quote reply</TooltipContent>
									</Tooltip>
								)}
								{onBranch && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onBranch}>
												<GitBranch className="h-3 w-3" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Branch from here</TooltipContent>
									</Tooltip>
								)}
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete}>
											<Trash2 className="h-3 w-3" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Delete</TooltipContent>
								</Tooltip>
							</div>
						</div>
					</div>
				</TooltipProvider>
			);
		}

		return (
<TooltipProvider delayDuration={300}>
				<div className="group my-3 flex min-w-0 flex-col">
					<div className="w-full min-w-0">
						{shouldShowTiming && (
							<div className="mb-1.5 border-b border-border/60 pb-1">
								<button type="button" className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => setActivityOpen(value => !value)}>
									<Clock className="h-3 w-3" /><span>{message.streaming ? "Working for" : "Worked for"} {formatElapsed(elapsedMs)}</span><ChevronDown className={cn("ml-0.5 h-3 w-3 transition-transform", activityOpen && "rotate-180")} />
								</button>
								<div className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-out", activityOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}><div className="min-h-0 overflow-hidden"><div className="mt-2 flex flex-col">{groupedActivity.map((segment, index) => segment.kind === "thinking" ? <ThinkingBlock key={`thinking-${index}`} text={segment.text} streaming={!!message.streaming && index === groupedActivity.length - 1} /> : segment.kind === "tool-group" ? <div key={`tools-${index}`} className="border-b border-border/40 py-1">{segment.calls.length > 1 ? <ToolCardStack calls={segment.calls} /> : <ToolCard call={segment.calls[0]} />}</div> : <CheckpointDivider key={(segment as any).checkpointId} stepNumber={(segment as any).stepNumber} filesTouched={(segment as any).filesTouched} restored={(segment as any).restored} />)}</div></div></div>
							</div>
						)}

						<div className="select-text">
							{message.streaming && !hasVisibleAssistantContent && (
								<div className="py-2" role="status" aria-label="Assistant is working">
									<span className="shimmer-text text-sm font-medium">Thinking</span>
								</div>
							)}
							{message.segments && message.segments.length > 0
								? <MessageSegments segments={message.segments} streaming={!!message.streaming} onRestoreCheckpoint={onRestoreCheckpoint} />
								: displayContent ? <MarkdownRenderer content={displayContent} /> : null}
						</div>

						{(message.memoryAdded || message.bookmarked || ((message.chatMode === "merge" || message.chatMode === "websearch") && hasVisibleAssistantContent)) && (
							<div className="mt-2 flex flex-wrap gap-1.5">
								{message.chatMode === "merge" && hasVisibleAssistantContent && (
									<Badge variant="outline" className="h-5 gap-1 px-1.5 text-[0.65rem] text-primary"><Merge className="h-3 w-3" />Merged response</Badge>
								)}
								{message.chatMode === "websearch" && hasVisibleAssistantContent && (
									<Badge variant="outline" className="h-5 gap-1 px-1.5 text-[0.65rem] text-sky-500"><Search className="h-3 w-3" />Web search</Badge>
								)}
								{message.memoryAdded && (
									<Badge variant="outline" className="h-5 cursor-pointer gap-1 px-1.5 text-[0.65rem] text-violet-500" onClick={onMemoryClick}>
										<Brain className="h-3 w-3" />Saved to memory
									</Badge>
								)}
								{message.bookmarked && (
									<Badge variant="outline" className="h-5 gap-1 px-1.5 text-[0.65rem] text-amber-500"><Bookmark className="h-3 w-3 fill-current" />Bookmarked</Badge>
								)}
							</div>
						)}

						{message.searchSources && message.searchSources.length > 0 && (
							<SearchSources sources={message.searchSources} />
						)}

						{!message.streaming && hasVisibleAssistantContent && (
							<div className="mt-2 flex items-center justify-between gap-1">
								<div className="flex items-center gap-0.5">
									<Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={copy} className="h-7 w-7 text-muted-foreground">
										{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
									</Button></TooltipTrigger><TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent></Tooltip>
									<Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onRegenerate} className="h-7 w-7 text-muted-foreground">
										<RefreshCw className="h-3 w-3" />
									</Button></TooltipTrigger><TooltipContent>Retry</TooltipContent></Tooltip>
{isLast && (
										<Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onContinue} className="h-7 w-7 text-muted-foreground">
											<ChevronsRight className="h-3 w-3" />
										</Button></TooltipTrigger><TooltipContent>Continue</TooltipContent></Tooltip>
									)}
									<div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
									{onBranch && (
										<Tooltip>
											<TooltipTrigger asChild>
												<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onBranch}>
													<GitBranch className="h-3 w-3" />
												</Button>
											</TooltipTrigger>
											<TooltipContent>Branch from here</TooltipContent>
										</Tooltip>
									)}
									{onQuote && (
										<Tooltip>
											<TooltipTrigger asChild>
												<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onQuote}>
													<Quote className="h-3 w-3" />
												</Button>
											</TooltipTrigger>
											<TooltipContent>Quote reply</TooltipContent>
										</Tooltip>
									)}
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="ghost" size="icon" className={cn("h-7 w-7 text-muted-foreground", message.bookmarked && "text-amber-500")} onClick={onBookmark}>
												{message.bookmarked ? <Bookmark className="h-3 w-3 fill-current" /> : <BookmarkPlus className="h-3 w-3" />}
											</Button>
										</TooltipTrigger>
										<TooltipContent>{message.bookmarked ? "Remove bookmark" : "Bookmark"}</TooltipContent>
									</Tooltip>
									</div>
								</div>
								<div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
									<span className="text-xs text-muted-foreground">{time}</span>
									{wordCount > 0 && (
										<span className="text-xs text-muted-foreground/60">{wordCount} words</span>
									)}
									{message.chatMode === "merge" && (
										<Badge variant="outline" className="h-4 px-1.5 text-[0.6rem] text-primary">Merge</Badge>
									)}
									{message.chatMode === "websearch" && (
										<Badge variant="outline" className="h-4 px-1.5 text-[0.6rem] text-sky-500">Web Search</Badge>
									)}
									{!message.chatMode && message.model && (
										<Badge variant="outline" className="h-4 px-1.5 text-[0.6rem]">{message.model}</Badge>
									)}
									<Tooltip>
										<TooltipTrigger asChild>
											<Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
												<Trash2 className="h-3 w-3" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Delete</TooltipContent>
									</Tooltip>
								</div>
							</div>
						)}
					</div>
				</div>
			</TooltipProvider>
		);
	}

	const MessageRow = memo(MessageRowImpl, (prev, next) => {
		return (
			prev.message === next.message &&
			prev.nickname === next.nickname &&
			prev.isLast === next.isLast &&
			prev.elapsedMs === next.elapsedMs
		);
	});

	export default MessageRow;


function PresentedFile({ name, content, mimeType: _mimeType, size }: { name: string; content: string; mimeType: string; size: number }) {
	const [preview, setPreview] = useState(false);
	return (
		<>
			<div className="my-2">
				<div
					className="group/file flex h-32 w-32 cursor-pointer flex-col overflow-hidden rounded-md border border-border bg-card transition-transform hover:scale-[1.02]"
					onClick={() => setPreview(true)}
					title="Click to preview"
				>
					<div className="flex-1 overflow-hidden p-2 font-mono text-[9px] leading-tight text-muted-foreground">
						<pre className="whitespace-pre-wrap break-words">{content.split("\n").slice(0, 6).join("\n")}</pre>
					</div>
					<div className="flex items-center gap-1 border-t bg-muted/40 px-1.5 py-1">
						<Paperclip className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
						<span className="truncate text-[10px] font-medium">{name}</span>
					</div>
				</div>
			</div>
			{preview && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPreview(false)}>
					<div className="flex h-[80vh] w-[min(900px,90vw)] flex-col overflow-hidden rounded-lg border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between border-b px-4 py-2">
							<div className="flex items-center gap-2 truncate">
								<Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
								<span className="truncate text-sm font-medium">{name}</span>
								<span className="shrink-0 text-xs text-muted-foreground">({size.toLocaleString()} bytes)</span>
							</div>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreview(false)}>
								<X className="h-4 w-4" />
							</Button>
						</div>
						<div className="flex-1 overflow-auto p-4"><MarkdownRenderer content={"```" + languageFromName(name) + "\n" + content + "\n```"} /></div>
					</div>
				</div>
			)}
		</>
	);
}

	function AttachmentStrip({ attachments }: { attachments: Attachment[] }) {
		const lightbox = useLightbox();
		const [previewText, setPreviewText] = useState<{ name: string; content: string } | null>(null);
		const imageAtts = attachments.filter(a => (!!a.thumbDataUrl || /^image\//i.test(a.mimeType)) && (a.content || a.thumbDataUrl));
		return (
			<>
				<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
					{attachments.map(att => {
						const isImg = !!att.thumbDataUrl || /^image\//i.test(att.mimeType);
						if (isImg && att.thumbDataUrl) {
							return (
								<button
									type="button"
									key={`${att.name}-${att.size}`}
									onClick={() => {
										const startIdx = imageAtts.findIndex(a => a === att);
										lightbox.open(
											imageAtts.map(a => ({ src: a.content || a.thumbDataUrl || "", alt: a.name, name: a.name })),
											Math.max(0, startIdx),
										);
									}}
									className="attachment-checker block h-32 w-32 cursor-zoom-in overflow-hidden rounded-xl border border-border bg-transparent transition-transform hover:scale-[1.02]"
									title={`${att.name} - ${formatBytes(att.size ?? 0)}`}
								>
									<img src={att.thumbDataUrl} alt={att.name} className="h-full w-full rounded-xl bg-transparent object-contain" />
								</button>
							);
						}
						const isText = !att.isBinary && (att.content?.length ?? 0) > 0;
						const snippet = isText ? att.content!.split("\n").slice(0, 6).join("\n") : "";
						return (
							<div
								key={`${att.name}-${att.size}`}
								className={cn(
									"flex h-32 w-32 flex-col overflow-hidden rounded-md border border-border bg-card transition-transform",
									isText && "cursor-pointer hover:scale-[1.02]",
								)}
								title={isText ? "Click to preview" : (att.path ?? att.name)}
								onClick={isText ? () => setPreviewText({ name: att.name, content: att.content! }) : undefined}
							>
								<div className="flex-1 overflow-hidden p-2 font-mono text-[9px] leading-tight text-muted-foreground">
									<pre className="whitespace-pre-wrap break-words">{snippet || "(binary)"}</pre>
								</div>
								<div className="flex items-center gap-1 border-t bg-muted/40 px-1.5 py-1">
									<Paperclip className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
									<span className="truncate text-[10px] font-medium">{att.name}</span>
								</div>
							</div>
						);
					})}
				</div>
				{previewText && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
						onClick={() => setPreviewText(null)}
					>
						<div
							className="flex h-[80vh] w-[min(900px,90vw)] flex-col overflow-hidden rounded-lg border bg-card shadow-2xl"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="flex items-center justify-between border-b px-4 py-2">
								<div className="flex items-center gap-2 truncate">
									<Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span className="truncate text-sm font-medium">{previewText.name}</span>
									<span className="shrink-0 text-xs text-muted-foreground">({previewText.content.length.toLocaleString()} chars)</span>
								</div>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewText(null)}>
									<X className="h-4 w-4" />
								</Button>
							</div>
							<div className="flex-1 overflow-auto p-4"><MarkdownRenderer content={"```" + languageFromName(previewText.name) + "\n" + previewText.content + "\n```"} /></div>
						</div>
					</div>
				)}
			</>
		);
	}

	function MessageSegments({ segments, streaming, onRestoreCheckpoint }: { segments: MessageSegment[]; streaming: boolean; onRestoreCheckpoint?: (checkpointId: string) => void }) {
		type StackBuf = { calls: ToolCallRecord[]; key: string };
		type RenderItem =
			| { kind: "stack"; calls: ToolCallRecord[]; key: string }
			| { kind: "seg"; segment: MessageSegment; idx: number };

		const items: RenderItem[] = [];
		let buf: StackBuf | null = null;
		const flush = () => {
			if (buf) {
				items.push({ kind: "stack", calls: buf.calls, key: buf.key });
				buf = null;
			}
		};
segments.forEach((segment, idx) => {
			if (segment.kind === "tool") {
				if (buf) {
					buf.calls.push(segment.call);
				} else {
					flush();
					buf = { calls: [segment.call], key: `stack-${segment.call.id}` };
				}
				return;
			}
			if (segment.kind === "text" && segment.text.trim() === "") {
				return;
			}
			flush();
			items.push({ kind: "seg", segment, idx });
		});
		flush();

		return (
			<div className="flex flex-col">
	{items.map((item) => {
					if (item.kind === "stack") {
						return null;
					}
					const { segment, idx } = item;
					if (segment.kind === "thinking") {
						return null;
					}
					if (segment.kind === "checkpoint") {
						return null;
					}
					if (segment.kind === "file") {
						return <PresentedFile key={`file-${idx}`} name={segment.name} content={segment.content} mimeType={segment.mimeType} size={segment.size} />;
					}
					if (segment.kind !== "text") return null;
					const isLiveText = streaming && idx === segments.length - 1;
					return <StreamingTextV2 key={idx} text={segment.text} live={isLiveText} />;
				})}
			</div>
		);
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function SearchSources({ sources }: { sources: Array<{ title: string; url: string; snippet: string }> }) {
		const [expanded, setExpanded] = useState(false);
		if (!sources.length) return null;
		const shown = expanded ? sources : sources.slice(0, 3);

		function getDomain(url: string) {
			try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
		}

		function getFavicon(url: string) {
			try { const u = new URL(url); return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`; } catch { return null; }
		}

		return (
			<div className="mt-2.5">
				<div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
					<Search className="h-3 w-3" />
					<span>{sources.length} source{sources.length !== 1 ? "s" : ""}</span>
				</div>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
					{shown.map((src) => {
						const favicon = getFavicon(src.url);
						return (
							<a
								key={src.url}
								href={src.url}
								target="_blank"
								rel="noopener noreferrer"
								title={src.snippet}
								className="block rounded-md border border-border bg-card p-2 text-left transition-colors hover:border-primary hover:bg-accent/50"
							>
								<div className="mb-1 flex items-center gap-1">
									{favicon && <img src={favicon} alt="" width={14} height={14} className="rounded-sm" />}
									<span className="text-xs text-muted-foreground">{getDomain(src.url)}</span>
								</div>
								<div className="mb-0.5 text-sm font-semibold leading-tight">
									{src.title || getDomain(src.url)}
								</div>
								{src.snippet && (
									<div className="block text-xs leading-tight text-muted-foreground/70">
										{src.snippet.slice(0, 100)}{src.snippet.length > 100 ? "..." : ""}
									</div>
								)}
							</a>
						);
					})}
				</div>
				{sources.length > 3 && (
					<Button variant="ghost" size="sm" onClick={() => setExpanded(e => !e)} className="mt-1.5 h-7 px-2 text-xs">
						{expanded ? "Show fewer" : `Show ${sources.length - 3} more`}
					</Button>
				)}
			</div>
		);
	}

	function CheckpointDivider({ stepNumber, filesTouched, restored, onRestore }: { stepNumber: number; filesTouched: string[]; restored?: boolean; onRestore?: () => void }) {
		const [confirming, setConfirming] = useState(false);
		const count = filesTouched.length;
		const summary = count === 0
			? "No files modified"
			: count === 1
				? (filesTouched[0]?.split(/[\\/]/).pop() ?? filesTouched[0] ?? "")
				: `${count} files modified`;
		return (
			<div className={cn("my-2 flex items-center gap-2", restored ? "text-emerald-500" : "text-muted-foreground")}>
				<Separator className="flex-1" />
				<div className="flex items-center gap-1">
					<History className="h-3 w-3" />
					<span className="text-xs font-semibold">Step {stepNumber} · {summary}</span>
				</div>
				{onRestore && !restored && count > 0 && (
					confirming ? (
						<div className="flex items-center gap-1">
							<span className="text-xs">Restore files to this point?</span>
							<Button size="sm" className="h-6 bg-amber-500 px-2 text-[0.68rem] text-white hover:bg-amber-600" onClick={() => { onRestore(); setConfirming(false); }}>Yes, restore</Button>
							<Button size="sm" variant="ghost" className="h-6 px-2 text-[0.68rem]" onClick={() => setConfirming(false)}>Cancel</Button>
						</div>
					) : (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setConfirming(true)}
							title={`Revert files modified in step ${stepNumber} and after`}
							className="h-6 gap-1 border-amber-500/40 px-2 text-[0.68rem] text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
						>
							<RotateCcw className="h-3 w-3" />
							Restore Checkpoint
						</Button>
					)
				)}
				{restored && (
					<Badge variant="outline" className="h-4 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[0.65rem] text-emerald-500">Restored</Badge>
				)}
				<Separator className="flex-1" />
			</div>
		);
	}
