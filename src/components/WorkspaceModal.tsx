import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Workspace } from "../types";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { X, FolderOpen } from "lucide-react";
import { workspaceIcon } from "../lib/workspaceIcons";

const COLORS = ["#5865f2","#3ecf8e","#f04444","#f0a500","#a855f7","#06b6d4","#ec4899","#f97316"];
const ICONS = ["ðŸ ","ðŸ’¼","ðŸ’»","ðŸ“š","â­","ðŸ“","ðŸ”¬","ðŸŽ¯","ðŸš€","ðŸŽ¨","ðŸŒ","âš¡","ðŸ§ ","ðŸ”¥","ðŸ’¡","ðŸŽµ"];

interface WorkspaceModalProps {
	workspace?: Workspace;
	onSave: (data: Omit<Workspace, "id" | "createdAt">) => void;
	onClose: () => void;
	onDelete?: () => void;
}

type WsTab = "general" | "instructions" | "notes";

export default function WorkspaceModal({ workspace, onSave, onClose, onDelete }: WorkspaceModalProps) {
	const [tab, setTab] = useState<WsTab>("general");
	const [name, setName] = useState(workspace?.name ?? "");
	const [color, setColor] = useState<string>(workspace?.color ?? COLORS[0]!);
	const [icon, setIcon] = useState(workspace?.icon ?? "ðŸ ");
	const [workingDirectory, setWorkingDirectory] = useState(workspace?.workingDirectory ?? "");
	const [systemPrompt, setSystemPrompt] = useState(workspace?.systemPrompt ?? "");
	const [instructions, setInstructions] = useState(workspace?.instructions ?? "");
	const [notes, setNotes] = useState(workspace?.notes ?? "");
	const [directoryError, setDirectoryError] = useState("");
	const [browsingDirectory, setBrowsingDirectory] = useState(false);

	async function browseDirectory() {
		setDirectoryError("");
		setBrowsingDirectory(true);
		try {
			const selected = await invoke<string | null>("select_directory", {
				initial: workingDirectory.trim() || null,
			});
			if (selected) setWorkingDirectory(selected);
		} catch (err) {
			setDirectoryError(String(err));
		} finally {
			setBrowsingDirectory(false);
		}
	}

	function handleSave() {
		if (!name.trim()) return;
		onSave({
			name: name.trim(),
			color,
			icon,
			workingDirectory: workingDirectory.trim(),
			systemPrompt,
			instructions,
			notes,
			pinnedFiles: workspace?.pinnedFiles ?? [],
			recentFiles: workspace?.recentFiles ?? [],
		});
		onClose();
	}

	const tabs: { id: WsTab; label: string }[] = [
		{ id: "general", label: "General" },
		{ id: "instructions", label: "Instructions" },
		{ id: "notes", label: "Notes" },
	];

	return (
		<TooltipProvider delayDuration={300}>
			<Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
				<DialogContent className="flex h-[80vh] max-h-[80vh] max-w-3xl flex-row gap-0 overflow-hidden p-0">
					<div className="flex w-[220px] shrink-0 flex-col justify-between border-r border-border bg-muted/30">
						<div>
							<div className="px-5 pb-3 pt-5">
								<h2 className="text-lg font-bold leading-tight">{workspace ? "Edit Workspace" : "New Workspace"}</h2>
							</div>
							<nav className="flex flex-col gap-0.5 px-3">
								{tabs.map(t => (
									<button
										key={t.id}
										type="button"
										onClick={() => setTab(t.id)}
										className={cn(
											"rounded-md px-3 py-1.5 text-left text-sm font-medium transition-colors",
											tab === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
										)}
									>
										{t.label}
									</button>
								))}
							</nav>
						</div>
						{workspace && workspace.id !== "default" && onDelete && (
							<div className="p-3">
								<Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
									Delete Workspace
								</Button>
							</div>
						)}
					</div>

					<div className="flex min-w-0 flex-1 flex-col">
						<div className="flex items-center justify-between px-6 pb-2 pt-5">
							<h3 className="text-lg font-semibold capitalize">{tab}</h3>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
								<X className="h-4 w-4" />
							</Button>
						</div>

						<div className="flex-1 overflow-y-auto px-6 pb-6">
							{tab === "general" && (
								<div className="flex flex-col gap-5">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="ws-name">Name</Label>
										<Input
											id="ws-name"
											placeholder="Workspace name"
											value={name}
											onChange={e => setName(e.target.value)}
											autoFocus
										/>
									</div>

									<div className="flex flex-col gap-2">
										<Label>Icon</Label>
										<div className="grid grid-cols-8 gap-1.5">
											{ICONS.map(ic => {
												const IconCmp = workspaceIcon(ic);
												const selected = icon === ic;
												return (
													<Tooltip key={ic}>
														<TooltipTrigger asChild>
															<button
																type="button"
																onClick={() => setIcon(ic)}
																className={cn(
																	"flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
																	selected ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-accent",
																)}
															>
																<IconCmp className="h-4 w-4" />
															</button>
														</TooltipTrigger>
														<TooltipContent>{ic}</TooltipContent>
													</Tooltip>
												);
											})}
										</div>
									</div>

									<div className="flex flex-col gap-2">
										<Label>Color</Label>
										<div className="flex gap-2">
											{COLORS.map(c => (
												<button
													key={c}
													type="button"
													onClick={() => setColor(c)}
													className={cn(
														"h-7 w-7 rounded-full transition-transform hover:scale-110",
														color === c && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
													)}
													style={{ backgroundColor: c }}
												/>
											))}
										</div>
									</div>

									<div className="flex flex-col gap-1.5">
										<Label htmlFor="ws-dir">Working Directory</Label>
										<div className="flex gap-2">
											<Input
												id="ws-dir"
												placeholder="D:\Projects\my-app"
												value={workingDirectory}
												onChange={e => setWorkingDirectory(e.target.value)}
												className="flex-1"
											/>
											<Button
												variant="outline"
												onClick={browseDirectory}
												disabled={browsingDirectory}
												className="shrink-0 gap-1.5"
											>
												<FolderOpen className="h-4 w-4" />
												{browsingDirectory ? "Openingâ€¦" : "Browse"}
											</Button>
										</div>
										<p className="text-xs text-muted-foreground">
											File tools and terminal commands run relative to this folder.
										</p>
										{directoryError && (
											<p className="text-xs text-destructive">{directoryError}</p>
										)}
									</div>

									<div className="flex flex-col gap-1.5">
										<Label htmlFor="ws-prompt">System Prompt</Label>
										<Textarea
											id="ws-prompt"
											placeholder="Instructions for all chats in this workspace..."
											value={systemPrompt}
											onChange={e => setSystemPrompt(e.target.value)}
											rows={3}
										/>
									</div>
								</div>
							)}

							{tab === "instructions" && (
								<div className="flex flex-col gap-2">
									<Label htmlFor="ws-inst" className="text-sm font-medium">Workspace Instructions</Label>
									<p className="text-xs text-muted-foreground">
										These instructions are prepended to all conversations in this workspace.
									</p>
									<Textarea
										id="ws-inst"
										placeholder="e.g. This workspace is for my React project. Always use TypeScript..."
										value={instructions}
										onChange={e => setInstructions(e.target.value)}
										rows={12}
									/>
								</div>
							)}

							{tab === "notes" && (
								<div className="flex flex-col gap-2">
									<Label htmlFor="ws-notes" className="text-sm font-medium">Workspace Notes</Label>
									<p className="text-xs text-muted-foreground">
										Personal notes for this workspace. Not sent to the agent.
									</p>
									<Textarea
										id="ws-notes"
										placeholder="Project notes, links, reminders..."
										value={notes}
										onChange={e => setNotes(e.target.value)}
										rows={12}
									/>
								</div>
							)}
						</div>

						<div className="flex justify-end gap-2 border-t border-border bg-card px-6 py-3">
							<Button variant="ghost" onClick={onClose}>Cancel</Button>
							<Button onClick={handleSave} disabled={!name.trim()}>
								{workspace ? "Save Changes" : "Create Workspace"}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</TooltipProvider>
	);
}
