const fs = require("fs");

// 1. ChatInputBox: revert paste to textbox-attachment behavior
{
	const p = "src/components/ChatInputBox.tsx";
	let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
	const find = `	function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
		const text = e.clipboardData.getData("text");
		if (text && text.length > 2000) {
			e.preventDefault();
			const name = \`pasted-\${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt\`;
			if (onAddConvFile) {
				onAddConvFile({ name, content: text, mimeType: "text/plain", size: text.length, source: "user", isBinary: false });
				return;
			}
			const blob = new Blob([text], { type: "text/plain" });
			const file = new File([blob], name, { type: "text/plain" });
			addFiles([file]);
		}
	}`;
	const rep = `	function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
		const text = e.clipboardData.getData("text");
		if (text && text.length > 2000) {
			e.preventDefault();
			const name = \`pasted-\${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt\`;
			const blob = new Blob([text], { type: "text/plain" });
			const file = new File([blob], name, { type: "text/plain" });
			addFiles([file]);
		}
	}`;
	if (!s.includes(find)) { console.error("paste find missed"); process.exit(1); }
	s = s.replace(find, rep);
	fs.writeFileSync(p, s.replace(/\n/g, "\r\n"));
	console.log("ChatInputBox paste reverted");
}

// 2. MessageRow AttachmentStrip: bigger images + clickable text preview
{
	const p = "src/components/MessageRow.tsx";
	let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
	const find = `	function AttachmentStrip({ attachments }: { attachments: Attachment[] }) {
		const lightbox = useLightbox();
		const imageAtts = attachments.filter(a => (!!a.thumbDataUrl || /^image\\//i.test(a.mimeType)) && (a.content || a.thumbDataUrl));
		return (
			<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
				{attachments.map(att => {
					const isImg = !!att.thumbDataUrl || /^image\\//i.test(att.mimeType);
					if (isImg && att.thumbDataUrl) {
						return (
							<button
								type="button"
								key={\`\${att.name}-\${att.size}\`}
								onClick={() => {
									const startIdx = imageAtts.findIndex(a => a === att);
									lightbox.open(
										imageAtts.map(a => ({ src: a.content || a.thumbDataUrl || "", alt: a.name, name: a.name })),
										Math.max(0, startIdx),
									);
								}}
								className="attachment-checker block h-20 w-20 cursor-zoom-in overflow-hidden rounded-md border border-border transition-transform hover:scale-[1.02]"
								title={\`\${att.name} - \${formatBytes(att.size ?? 0)}\`}
							>
								<img src={att.thumbDataUrl} alt={att.name} className="h-full w-full object-contain" />
							</button>
						);
					}
					return (
						<Badge
							key={\`\${att.name}-\${att.size}\`}
							variant="outline"
							className="h-5 gap-1 px-1.5 text-[0.65rem]"
							title={att.path ?? att.name}
						>
							<Paperclip className="h-3 w-3" />
							<span>{att.name}</span>
							<span className="text-muted-foreground/70">{formatBytes(att.size ?? 0)}</span>
						</Badge>
					);
				})}
			</div>
		);
	}`;
	const rep = `	function AttachmentStrip({ attachments }: { attachments: Attachment[] }) {
		const lightbox = useLightbox();
		const [previewText, setPreviewText] = useState<{ name: string; content: string } | null>(null);
		const imageAtts = attachments.filter(a => (!!a.thumbDataUrl || /^image\\//i.test(a.mimeType)) && (a.content || a.thumbDataUrl));
		return (
			<>
				<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
					{attachments.map(att => {
						const isImg = !!att.thumbDataUrl || /^image\\//i.test(att.mimeType);
						if (isImg && att.thumbDataUrl) {
							return (
								<button
									type="button"
									key={\`\${att.name}-\${att.size}\`}
									onClick={() => {
										const startIdx = imageAtts.findIndex(a => a === att);
										lightbox.open(
											imageAtts.map(a => ({ src: a.content || a.thumbDataUrl || "", alt: a.name, name: a.name })),
											Math.max(0, startIdx),
										);
									}}
									className="attachment-checker block h-32 w-32 cursor-zoom-in overflow-hidden rounded-md border border-border transition-transform hover:scale-[1.02]"
									title={\`\${att.name} - \${formatBytes(att.size ?? 0)}\`}
								>
									<img src={att.thumbDataUrl} alt={att.name} className="h-full w-full object-contain" />
								</button>
							);
						}
						const isText = !att.isBinary && (att.content?.length ?? 0) > 0;
						const snippet = isText ? att.content!.split("\\n").slice(0, 6).join("\\n") : "";
						return (
							<div
								key={\`\${att.name}-\${att.size}\`}
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
							<pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">{previewText.content}</pre>
						</div>
					</div>
				)}
			</>
		);
	}`;
	if (!s.includes(find)) { console.error("AttachmentStrip find missed"); process.exit(1); }
	s = s.replace(find, rep);
	// Add X import if missing
	if (!s.includes("X,\n\t\tGitBranch") && !s.includes(", X,") && !s.match(/\bX,\s/)) {
		s = s.replace("GitBranch, Quote,", "GitBranch, Quote, X,");
	}
	fs.writeFileSync(p, s.replace(/\n/g, "\r\n"));
	console.log("AttachmentStrip upgraded");
}

console.log("done");