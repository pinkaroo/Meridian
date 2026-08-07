import { useState, useMemo } from "react";
import { FileText, Image as ImageIcon, FileCode, File, Trash2, Download, Pencil, Copy } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";
import type { ConvFile } from "../types";

interface FileViewerPanelProps {
	open: boolean;
	onClose: () => void;
	files: ConvFile[];
	onDelete: (fileId: string) => void;
	onRename: (fileId: string, newName: string) => void;
}

function iconFor(mime: string) {
	if (mime.startsWith("image/")) return ImageIcon;
	if (mime.startsWith("text/") || mime === "application/json") return FileText;
	if (mime.includes("javascript") || mime.includes("typescript") || mime.includes("python") || mime.includes("html") || mime.includes("css")) return FileCode;
	return File;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewerPanel({ open, onClose, files, onDelete, onRename }: FileViewerPanelProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");

	const selected = useMemo(() => files.find(f => f.id === selectedId) ?? null, [files, selectedId]);
	const sorted = useMemo(() => [...files].sort((a, b) => b.createdAt - a.createdAt), [files]);

	const handleDownload = (file: ConvFile) => {
		const blob = file.isBinary
			? (() => {
				const bytes = Uint8Array.from(atob(file.content), c => c.charCodeAt(0));
				return new Blob([bytes], { type: file.mimeType });
			})()
			: new Blob([file.content], { type: file.mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = file.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const commitRename = (file: ConvFile) => {
		const trimmed = renameValue.trim();
		if (trimmed && trimmed !== file.name) onRename(file.id, trimmed);
		setRenamingId(null);
		setRenameValue("");
	};

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogContent className="w-[calc(100vw-2rem)] max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
				<DialogHeader className="px-6 py-4 border-b">
					<DialogTitle className="flex items-center gap-2">
						<File className="h-5 w-5" />
						Conversation files
						<span className="text-sm text-muted-foreground font-normal">({files.length})</span>
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-1 min-h-0">
					<div className="w-72 max-md:w-44 shrink-0 border-r overflow-y-auto">
						{sorted.length === 0 ? (
							<div className="p-6 text-sm text-muted-foreground text-center">
								No files in this conversation yet.
							</div>
						) : (
							<div className="p-2 space-y-1">
								{sorted.map(file => {
									const Icon = iconFor(file.mimeType);
									const isSelected = selectedId === file.id;
									const isRenaming = renamingId === file.id;
									return (
										<div
											key={file.id}
											className={cn(
												"group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
												isSelected ? "bg-accent" : "hover:bg-accent/50"
											)}
											onClick={() => !isRenaming && setSelectedId(file.id)}
										>
											<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
											<div className="flex-1 min-w-0">
												{isRenaming ? (
													<Input
														autoFocus
														value={renameValue}
														onChange={(e) => setRenameValue(e.target.value)}
														onBlur={() => commitRename(file)}
														onKeyDown={(e) => {
															if (e.key === "Enter") commitRename(file);
															if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
														}}
														onClick={(e) => e.stopPropagation()}
														className="h-7 text-xs"
													/>
												) : (
													<>
														<div className="text-sm truncate font-medium">{file.name}</div>
														<div className="text-xs text-muted-foreground flex items-center gap-1.5">
															<span>{formatSize(file.size)}</span>
															<span>*</span>
															<span className={file.source === "agent" ? "text-blue-500" : ""}>{file.source}</span>
														</div>
													</>
												)}
											</div>
											{!isRenaming && (
												<div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
													<Button
														size="icon"
														variant="ghost"
														className="h-7 w-7"
														onClick={(e) => {
															e.stopPropagation();
															setRenamingId(file.id);
															setRenameValue(file.name);
														}}
														title="Rename"
													>
														<Pencil className="h-3.5 w-3.5" />
													</Button>
													<Button
														size="icon"
														variant="ghost"
														className="h-7 w-7"
														onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
														title="Download"
													>
														<Download className="h-3.5 w-3.5" />
													</Button>
													<Button
														size="icon"
														variant="ghost"
														className="h-7 w-7 text-destructive hover:text-destructive"
														onClick={(e) => {
															e.stopPropagation();
															if (confirm(`Delete "${file.name}"? This cannot be undone.`)) {
																onDelete(file.id);
																if (selectedId === file.id) setSelectedId(null);
															}
														}}
														title="Delete"
													>
														<Trash2 className="h-3.5 w-3.5" />
													</Button>
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>

					<div className="flex-1 overflow-hidden flex flex-col">
						{selected ? (
							<>
								<div className="px-4 py-3 border-b flex items-center justify-between bg-muted/30">
									<div className="min-w-0">
										<div className="font-medium truncate">{selected.name}</div>
										<div className="text-xs text-muted-foreground">
											{selected.mimeType} * {formatSize(selected.size)}
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-2">
									<Button size="sm" variant="outline" onClick={() => handleDownload(selected)}>
										<Download className="h-3.5 w-3.5 mr-1.5" />
										Download
									</Button>
									{selected.content != null && <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(selected.content ?? "")}>
										<Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
									</Button>}
									</div>
								</div>
								<div className="flex-1 overflow-auto attachment-checker">
									{selected.mimeType.startsWith("image/") ? (
										<div className="h-full flex items-center justify-center p-4">
											<img
												src={selected.isBinary ? `data:${selected.mimeType};base64,${selected.content}` : selected.content}
												alt={selected.name}
												className="max-w-full max-h-full object-contain"
											/>
										</div>
									) : (
										<pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words text-foreground">
											{selected.isBinary
												? "(binary file -- use Download to save)"
												: selected.content}
										</pre>
									)}
								</div>
							</>
						) : (
							<div className="h-full flex items-center justify-center text-muted-foreground text-sm">
								Select a file to preview
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
