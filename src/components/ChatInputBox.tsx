import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Paperclip, Send, X, Mic, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Attachment } from "../types";

import { MAX_TEXT_ATTACHMENT_BYTES as MAX_TEXT_BYTES } from "../lib/agentRunner";
import { isImageFile, isImageMime, processImageFile } from "../lib/imageAttachment";
import { useLightbox } from "./ImageLightbox";
import MarkdownRenderer from "./MarkdownRenderer";
import { languageFromName } from "../lib/languageFromName";

export default function ChatInputBox({ onSend, onStop, isWorking, isWaitingApproval, sendOnEnter, draft, onDraftChange, onAddConvFile, onAskForApproval }: {
	onSend: (t: string, attachments?: Attachment[]) => void;
	onStop?: () => void;
	isWorking: boolean;
	isWaitingApproval: boolean;
	sendOnEnter: boolean;
	draft: string;
	onDraftChange: (d: string) => void;
	onImport?: () => void;
	onAddConvFile?: (file: { name: string; content: string; mimeType: string; size: number; source: "user" | "agent"; isBinary: boolean }) => void;
	onAskForApproval?: (mode?: "ask" | "safe" | "full") => void;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [uploading, setUploading] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);
	const [localDraft, setLocalDraft] = useState(draft);
	const lightbox = useLightbox();
	const [previewText, setPreviewText] = useState<{ name: string; content: string } | null>(null);
	const [listening, setListening] = useState(false);
	const [micSeconds, setMicSeconds] = useState(0);
	const recognitionRef = useRef<any>(null);
	useEffect(() => {
		if (!listening) { setMicSeconds(0); return; }
		const started = Date.now();
		const timer = window.setInterval(() => setMicSeconds(Math.floor((Date.now() - started) / 1000)), 250);
		return () => window.clearInterval(timer);
	}, [listening]);
	const [levels, setLevels] = useState<number[]>(Array.from({ length: 20 }, () => 2));
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const levelFrameRef = useRef<number | null>(null);
	const silenceStartedRef = useRef<number | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const [approvalMode, setApprovalMode] = useState<"ask" | "safe" | "full">("safe");
	const [approvalOpen, setApprovalOpen] = useState(false);
	function startDictation() {
		if (listening) { recognitionRef.current?.stop?.(); recognitionRef.current = null; mediaStreamRef.current?.getTracks().forEach(track => track.stop()); mediaStreamRef.current = null; audioContextRef.current?.close(); audioContextRef.current = null; if (levelFrameRef.current) cancelAnimationFrame(levelFrameRef.current); setListening(false); setLevels(Array.from({ length: 20 }, () => 2)); return; }
		if (!navigator.mediaDevices?.getUserMedia) { setFileError("Microphone access is unavailable in this environment."); return; }
		silenceStartedRef.current = null;
		const speechWindow = window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
		const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
		if (SpeechRecognition) {
			const recognition = new SpeechRecognition();
			recognitionRef.current = recognition;
			recognition.lang = navigator.language || "en-US";
			recognition.continuous = false;
			recognition.interimResults = false;
			recognition.onresult = (event: any) => {
				const transcript = Array.from(event.results ?? []).map((result: any) => result?.[0]?.transcript ?? "").join("").trim();
				if (transcript) { const next = localDraft.trim() ? `${localDraft.trimEnd()} ${transcript}` : transcript; setLocalDraft(next); onDraftChange(next); }
			};
			recognition.onerror = () => { recognitionRef.current = null; };
			recognition.onend = () => { recognitionRef.current = null; mediaStreamRef.current?.getTracks().forEach(track => track.stop()); mediaStreamRef.current = null; audioContextRef.current?.close(); audioContextRef.current = null; if (levelFrameRef.current) cancelAnimationFrame(levelFrameRef.current); setListening(false); };
			recognition.start();
		}
		void navigator.mediaDevices.getUserMedia({ audio: true }).then(async stream => {
			mediaStreamRef.current = stream;
			setListening(true);
			const context = new AudioContext();
			audioContextRef.current = context;
			await context.resume();
			const analyser = context.createAnalyser(); analyser.fftSize = 64;
			context.createMediaStreamSource(stream).connect(analyser);
			const data = new Uint8Array(analyser.frequencyBinCount);
			const tick = () => {
				analyser.getByteFrequencyData(data);
				const peak = Math.max(...data);
				if (peak < 10) {
					if (!silenceStartedRef.current) silenceStartedRef.current = Date.now();
					if (Date.now() - silenceStartedRef.current > 500) { recognitionRef.current?.stop?.(); recognitionRef.current = null; mediaStreamRef.current?.getTracks().forEach(track => track.stop()); mediaStreamRef.current = null; audioContextRef.current?.close(); audioContextRef.current = null; if (levelFrameRef.current) cancelAnimationFrame(levelFrameRef.current); levelFrameRef.current = null; silenceStartedRef.current = null; setListening(false); setLevels(Array.from({ length: 20 }, () => 2)); return; }
				} else silenceStartedRef.current = null;
				setLevels(Array.from({ length: 20 }, (_, index) => Math.max(2, Math.min(16, Math.round((data[index % data.length] / 255) * 16)))));
				levelFrameRef.current = requestAnimationFrame(tick);
			};
			tick();
	}).catch(() => setFileError("Microphone access was denied or unavailable."));
		return;
	}
	useEffect(() => { setLocalDraft(draft); }, [draft]);

	function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
		const text = e.clipboardData.getData("text");
		if (text && text.length > 2000) {
			e.preventDefault();
			const name = `pasted-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt`;
			const blob = new Blob([text], { type: "text/plain" });
			const file = new File([blob], name, { type: "text/plain" });
			addFiles([file]);
		}
	}

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = Math.min(el.scrollHeight, 360) + "px";
	}, [localDraft]);

	useEffect(() => {
		const onDragOver = (event: DragEvent) => {
			if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
		};
		const onDrop = (event: DragEvent) => {
			if (!event.dataTransfer?.files.length) return;
			event.preventDefault();
			setDragOver(false);
			void addFiles(event.dataTransfer.files);
		};
		document.addEventListener("dragover", onDragOver);
		document.addEventListener("drop", onDrop);
		return () => { document.removeEventListener("dragover", onDragOver); document.removeEventListener("drop", onDrop); };
	}, []);

	function send() {
		if (!localDraft.trim() && attachments.length === 0) return;
		onSend(localDraft, attachments);
		setLocalDraft("");
		onDraftChange("");
		setAttachments([]);
		setFileError(null);
	}


	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (sendOnEnter && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
	}

	async function addFiles(files: FileList | File[]) {
		const list = Array.from(files);
		if (list.length === 0) return;
		setFileError(null);
		const oversized = list.filter(f => !isImageFile(f) && !isBinaryFile(f) && f.size > MAX_TEXT_BYTES);
		if (oversized.length > 0) {
			setFileError(`File too large for inline text: ${oversized.map(f => f.name).join(", ")} (max 10 MB per text file)`);
			return;
		}
		setUploading(true);
		try {
			const loaded = await Promise.all(list.map(readAttachment));
			setAttachments(prev => [...prev, ...loaded]);
		} catch (err) {
			setFileError(err instanceof Error ? err.message : "Failed to read file");
		} finally {
			setUploading(false);
		}
	}

	const charCount = localDraft.length;
	const canSend = localDraft.trim().length > 0 || attachments.length > 0;

	return (
		<TooltipProvider delayDuration={300}>
			<div className="mx-auto w-full max-w-[800px] px-6 py-2.5">
				<div
					onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
					className={cn(
						"min-h-[100px] max-h-[380px] overflow-hidden rounded-2xl border bg-card p-2 transition-colors",
						dragOver ? "border-primary" : "border-border",
						"focus-within:border-border",
					)}
				>
					{(attachments.length > 0 || uploading) && (
						<div className="flex flex-wrap items-center gap-1.5 px-2 pb-1 pt-1">
							{attachments.map((att, idx) => {
								const isImg = isImageMime(att.mimeType, att.name) && !!att.thumbDataUrl;
								if (isImg) {
									return (
										<div
											key={att.name + "-" + idx}
											className="group/att attachment-checker relative h-32 w-32 cursor-zoom-in overflow-hidden rounded-md border border-border transition-transform hover:scale-[1.02]"
											title={`${att.name} - ${formatAttachmentBytes(att.size)}`}
											onClick={() => {
												const imgs = attachments.filter(a => isImageMime(a.mimeType, a.name) && !!a.thumbDataUrl);
												const startIdx = imgs.findIndex(a => a === att);
												lightbox.open(
													imgs.map(a => ({ src: a.content || a.thumbDataUrl || "", alt: a.name, name: a.name })),
													Math.max(0, startIdx),
												);
											}}
										>
											<img src={att.thumbDataUrl} alt={att.name} className="h-full w-full object-contain" />
											<button
												type="button"
												onClick={(e) => { e.stopPropagation(); setAttachments(prev => prev.filter((_, i) => i !== idx)); }}
												className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 opacity-0 shadow-sm transition-opacity group-hover/att:opacity-100 hover:bg-background"
											>
												<X className="h-3 w-3" />
											</button>
										</div>
									);
								}
								const isText = !att.isBinary && att.content.length > 0;
								const snippet = isText ? att.content.split("\n").slice(0, 6).join("\n") : "";
								return (
									<div
										key={att.name + "-" + idx}
										className={cn(
											"group/att relative flex h-32 w-32 flex-col overflow-hidden rounded-md border border-border bg-card transition-transform",
											isText && "cursor-pointer hover:scale-[1.02]",
										)}
										title={isText ? "Click to preview" : (att.path ?? att.name)}
										onClick={isText ? () => setPreviewText({ name: att.name, content: att.content }) : undefined}
									>
										<div className="flex-1 overflow-hidden p-2 font-mono text-[9px] leading-tight text-muted-foreground">
											<pre className="whitespace-pre-wrap break-words">{snippet || "(binary)"}</pre>
										</div>
										<div className="flex items-center gap-1 border-t bg-muted/40 px-1.5 py-1">
											<Paperclip className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
											<span className="truncate text-[10px] font-medium">{att.name}</span>
										</div>
										<button
											type="button"
											onClick={(e) => { e.stopPropagation(); setAttachments(prev => prev.filter((_, i) => i !== idx)); }}
											className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 opacity-0 shadow-sm transition-opacity group-hover/att:opacity-100 hover:bg-background"
										>
											<X className="h-3 w-3" />
										</button>
									</div>
								);
							})}
							{uploading && <span className="px-1 py-1 text-xs text-muted-foreground">Reading files...</span>}
						</div>
					)}
					{fileError && (
						<div className="mx-2 mb-1 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
							<span className="flex-1">{fileError}</span>
							<button type="button" onClick={() => setFileError(null)} className="shrink-0 rounded p-0.5 hover:bg-destructive/20">
								<X className="h-3 w-3" />
							</button>
						</div>
					)}
					<div className="relative flex flex-wrap items-end gap-1 px-1.5">
						<input
							ref={fileRef}
							type="file"
							multiple
							className="hidden"
							onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
						/>
						<Tooltip>
							<TooltipTrigger asChild>
														<Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} className="order-2 h-8 w-8 shrink-0 text-muted-foreground">
									<Plus className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Attach files or images</TooltipContent>
						</Tooltip>
						<textarea
							ref={ref}
							data-chat-input
							rows={1}
										placeholder={isWaitingApproval ? "Review the approval above or queue another instruction..." : isWorking ? "The agent is busy; your message will be queued..." : "Message the agent..."}
							value={localDraft}
							onChange={(e) => setLocalDraft(e.target.value)}
							onKeyDown={onKeyDown}
							onPaste={onPaste}
							onBlur={() => onDraftChange(localDraft)}
							className="order-1 min-h-[44px] basis-full resize-none overflow-y-auto bg-transparent px-2 py-2 pr-3 text-sm leading-5 outline-none placeholder:text-muted-foreground/60"
							style={{ maxHeight: 360 }}
						/>
						{charCount > 100 && (
							<span className={cn(
								"pointer-events-none absolute bottom-2 right-11 z-10 text-xs font-semibold tabular-nums",
								charCount > 8000 ? "text-amber-500" : "text-muted-foreground",
							)}>
								{charCount > 999 ? (charCount / 1000).toFixed(1) + "k" : charCount}
							</span>
						)}
		<button type="button" className="hidden">
							<span className="text-base">â—Œ</span>
						
						</button>
						<Popover open={approvalOpen} onOpenChange={setApprovalOpen}>
							<PopoverTrigger asChild><button type="button" className="order-2 flex h-8 items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground">{approvalMode === "ask" ? "Ask for approval" : approvalMode === "safe" ? "Approve for me" : "Full access"}</button></PopoverTrigger>
							<PopoverContent side="top" align="start" className="w-[360px] p-1"><p className="px-2.5 py-2 text-xs text-muted-foreground">How should Meridian actions be approved?</p>{([["ask", "Ask for approval", "Always ask before external files and network actions"], ["safe", "Approve for me", "Only pause for potentially unsafe actions"], ["full", "Full access", "Unrestricted workspace and network access"]] as const).map(([mode, label, description]) => <button key={mode} type="button" onClick={() => { setApprovalMode(mode); onAskForApproval?.(mode); setApprovalOpen(false); }} className={cn("block w-full rounded-md px-2.5 py-2 text-left hover:bg-accent", approvalMode === mode && "bg-accent")}><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{description}</span></button>)}</PopoverContent>
						</Popover>
						{listening && <span className="pointer-events-none absolute bottom-0 right-20 flex h-8 items-center gap-[2px] text-primary" aria-label="Recording"><span className="mr-1 text-[10px] tabular-nums text-muted-foreground">00:{String(micSeconds).padStart(2, "0")}</span>{levels.map((level, index) => <span key={index} className="w-[2px] rounded-full bg-current transition-[height] duration-75" style={{ height: `${level}px` }} />)}</span>}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button type="button" variant="ghost" size="icon" onClick={startDictation} className={cn("order-4 ml-auto h-8 w-8 text-muted-foreground", listening && "text-primary")} aria-label="Voice input">
									{listening ? <span className="h-3.5 w-3.5 rounded-[3px] bg-current" /> : <Mic className="h-4 w-4" />}
								</Button>
							</TooltipTrigger>
							<TooltipContent>{listening ? "Stop listening" : "Voice input"}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									 onClick={isWorking ? onStop : send}
									disabled={!isWorking && !canSend}
									size="icon"
									className="order-5 h-8 w-8 shrink-0 rounded-full"
								>
									{isWorking ? <span className="h-3.5 w-3.5 rounded-[3px] bg-current" /> : <Send className="h-4 w-4" />}
								</Button>
							</TooltipTrigger>
							<TooltipContent>{isWorking ? "Queue message" : "Send"}</TooltipContent>
						</Tooltip>
					</div>
				</div>
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
						<div className="flex-1 overflow-auto p-4">
							<MarkdownRenderer content={"```" + languageFromName(previewText.name) + "\n" + previewText.content + "\n```"} />
						</div>
					</div>
				</div>
			)}
		</TooltipProvider>
	);
}

async function readAttachment(file: File): Promise<Attachment> {
	if (isImageFile(file)) {
		const processed = await processImageFile(file);
		return {
			name: file.name,
			size: file.size,
			mimeType: processed.mimeType,
			isBinary: true,
			content: processed.fullDataUrl,
			thumbDataUrl: processed.thumbDataUrl,
		};
	}
	const isBinary = isBinaryFile(file);
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("Failed to read " + file.name));
		reader.onload = () => {
			const raw = String(reader.result ?? "");
			const content = isBinary ? "" : raw;
			resolve({ name: file.name, size: file.size, mimeType: file.type || guessBrowserMime(file.name), isBinary, content });
		};
		if (isBinary) reader.readAsDataURL(file);
		else reader.readAsText(file);
	});
}

function isBinaryFile(file: File): boolean {
	if (file.type.startsWith("text/")) return false;
	if (["application/json", "application/xml", "application/javascript"].includes(file.type)) return false;
	return !/\.(txt|md|json|js|jsx|ts|tsx|css|html|xml|csv|log|py|rs|toml|yaml|yml)$/i.test(file.name);
}

function guessBrowserMime(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase();
	if (ext === "json") return "application/json";
	if (["ts", "tsx"].includes(ext ?? "")) return "text/typescript";
	if (["js", "jsx"].includes(ext ?? "")) return "text/javascript";
	if (ext === "css") return "text/css";
	if (ext === "html") return "text/html";
	return "application/octet-stream";
}

function formatAttachmentBytes(bytes: number): string {
	if (bytes < 1024) return bytes + " B";
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
	return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
