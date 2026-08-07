import { useState, useEffect } from "react";
	import type { AppSettings, MemoryEntry, MemoryType } from "../types";
	import { getSettings as getAgentSettings, updateSettings as updateAgentSettings } from "../lib/settings";
	import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
	import { Button } from "@/components/ui/button";
	import { Input } from "@/components/ui/input";
	import { Textarea } from "@/components/ui/textarea";
	import { Label } from "@/components/ui/label";
	import { Switch } from "@/components/ui/switch";
	import { Badge } from "@/components/ui/badge";
	import { Separator } from "@/components/ui/separator";
	import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
	import { ScrollArea } from "@/components/ui/scroll-area";
	import { Search, Pencil, Trash2, Check, Ban, CheckCircle2, FolderOpen, Sun, Moon } from "lucide-react";
	import { cn } from "@/lib/utils";
import ModelPicker from "./ModelPicker";
import SkillSettings from "./SkillSettings";
import McpSettings from "./McpSettings";
import MarkdownRenderer from "./MarkdownRenderer";
	import { SHADCN_THEMES, applyTheme, getMode } from "../lib/theme";
	import type { ShadcnTheme, ColorMode } from "../types";

type Tab = "general" | "personalization" | "models" | "tools" | "skills" | "mcp" | "advanced" | "customization";

	interface SettingsModalProps {
		settings: AppSettings;
		onUpdate: (updates: Partial<AppSettings>) => void;
		onClose: () => void;
		defaultTab?: string;
		onAddMemory: (content: string, type?: MemoryType) => MemoryEntry;
		onUpdateMemory: (id: string, updates: Partial<MemoryEntry>) => void;
		onDeleteMemory: (id: string) => void;
		onToggleMemory: (id: string) => void;
		onOpenMcp?: () => void;
	}

	function SettingRow({ label, desc, control }: { label: string; desc?: string; control: React.ReactNode }) {
		return (
			<div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
				<div className="min-w-0 pr-2">
					<div className="text-sm font-semibold">{label}</div>
					{desc && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{desc}</div>}
				</div>
				<div className="shrink-0">{control}</div>
			</div>
		);
	}

	function SectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
		return (
			<div className={cn("mb-2 text-xs font-bold uppercase tracking-wide text-primary", first ? "mt-0" : "mt-6")}>
				{children}
			</div>
		);
	}

	function AgentToggleRow({ label, desc, field }: { label: string; desc: string; field: "compactReadTools" | "restrictToWorkingDir" | "confirmOutsideWorkingDir" }) {
		const [val, setVal] = useState<boolean>(() => getAgentSettings()[field]);
		return (
			<SettingRow
				label={label}
				desc={desc}
				control={<Switch checked={val} onCheckedChange={(v) => { setVal(v); updateAgentSettings({ [field]: v } as any); }} />}
			/>
		);
	}

	const TABS: Array<{ id: Tab; label: string }> = [
		{ id: "general", label: "General" },
		{ id: "personalization", label: "Personalization" },
		{ id: "models", label: "Models" },
{ id: "tools", label: "Tools" },
		{ id: "skills", label: "Skills" },
		{ id: "mcp", label: "MCP" },
		{ id: "customization", label: "Customization" },
		{ id: "advanced", label: "Advanced" },
	];

	export default function SettingsModal({
		settings, onUpdate, onClose, defaultTab,
		onAddMemory, onUpdateMemory, onDeleteMemory, onToggleMemory,
		onOpenMcp,
	}: SettingsModalProps) {
		const [tab, setTab] = useState<Tab>((defaultTab as Tab) ?? "general");
		const [newMemory, setNewMemory] = useState("");
		const [newMemoryType, setNewMemoryType] = useState<MemoryType>("user");
		const [memSearch, setMemSearch] = useState("");
		const [memTypeFilter, setMemTypeFilter] = useState<MemoryType | "all">("all");
		const [editingMemId, setEditingMemId] = useState<string | null>(null);
		const [editMemVal, setEditMemVal] = useState("");
		const [instructionsPreview, setInstructionsPreview] = useState(false);


		const allMemories = settings.memories ?? [];
		const filteredMemories = allMemories.filter(m => {
			const matchSearch = !memSearch || m.content.toLowerCase().includes(memSearch.toLowerCase());
			const matchType = memTypeFilter === "all" || m.type === memTypeFilter || (!m.type && memTypeFilter === "user");
			return matchSearch && matchType;
		});

		return (
			<Dialog open onOpenChange={(o) => !o && onClose()}>
				<DialogContent className="font-sans flex h-[85vh] max-h-[800px] w-[900px] max-w-[95vw] flex-row gap-0 overflow-hidden p-0">
					<div className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/30">
						<div className="px-5 pb-3 pt-5">
							<h2 className="text-base font-bold">Settings</h2>
						</div>
						<nav className="flex flex-col gap-0.5 px-2">
							{TABS.map(t => (
								<button
									key={t.id}
									type="button"
									onClick={() => setTab(t.id)}
									className={cn(
										"rounded-md px-3 py-1.5 text-left text-sm font-medium transition-colors",
										tab === t.id
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
									)}
								>
									{t.label}
								</button>
							))}
						</nav>
					</div>
					<div className="flex min-w-0 flex-1 flex-col">
						<div className="flex items-center px-6 pb-3 pt-5">
							<h3 className="text-base font-semibold">{tab === "mcp" ? "MCP" : tab.charAt(0).toUpperCase() + tab.slice(1)}</h3>
						</div>
						<ScrollArea className="flex-1 px-6 pb-6">
							{tab === "general" && <GeneralTab settings={settings} onUpdate={onUpdate} />}
							{tab === "personalization" && (
								<PersonalizationTab
									settings={settings} onUpdate={onUpdate}
									newMemory={newMemory} setNewMemory={setNewMemory}
									newMemoryType={newMemoryType} setNewMemoryType={setNewMemoryType}
									memSearch={memSearch} setMemSearch={setMemSearch}
									memTypeFilter={memTypeFilter} setMemTypeFilter={setMemTypeFilter}
									filteredMemories={filteredMemories}
									editingMemId={editingMemId} setEditingMemId={setEditingMemId}
									editMemVal={editMemVal} setEditMemVal={setEditMemVal}
									instructionsPreview={instructionsPreview} setInstructionsPreview={setInstructionsPreview}
									onAddMemory={onAddMemory} onUpdateMemory={onUpdateMemory}
									onDeleteMemory={onDeleteMemory} onToggleMemory={onToggleMemory}
								/>
							)}
							{tab === "models" && <ModelsTab settings={settings} onUpdate={onUpdate} />}
{tab === "tools" && <ToolsTab settings={settings} onUpdate={onUpdate} />}
							{tab === "skills" && <SkillSettings settings={settings} />}
							{tab === "mcp" && <McpSettings servers={settings.mcpServers ?? []} onUpdate={(mcpServers) => onUpdate({ mcpServers })} onClose={() => setTab("general")} embedded />}
							{tab === "customization" && <CustomizationTab settings={settings} onUpdate={onUpdate} />}
							{tab === "advanced" && <AdvancedTab settings={settings} onUpdate={onUpdate} />}
						</ScrollArea>
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	function GeneralTab({ settings, onUpdate }: { settings: AppSettings; onUpdate: (u: Partial<AppSettings>) => void }) {
		async function handleBrowse() {
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				const path = await invoke<string | null>("select_directory", { initial: settings.workdir });
				if (path) onUpdate({ workdir: path });
			} catch (err) {
				console.error("Failed to select directory:", err);
			}
		}

		return (
			<div>
				<SectionTitle first>Chat</SectionTitle>
				<SettingRow
					label="Send on Enter"
					desc="Press Enter to send. Shift+Enter for new line."
					control={<Switch checked={settings.sendOnEnter} onCheckedChange={(v) => onUpdate({ sendOnEnter: v })} />}
				/>
				<SectionTitle>Notifications</SectionTitle>
				<SettingRow
					label="Notify when response is done"
					desc="Desktop notification when agent finishes"
					control={<Switch checked={settings.notifyOnDone} onCheckedChange={(v) => onUpdate({ notifyOnDone: v })} />}
				/>
				<SettingRow
					label="Notify when approval needed"
					desc="Desktop notification when agent needs approval"
					control={<Switch checked={settings.notifyOnApproval} onCheckedChange={(v) => onUpdate({ notifyOnApproval: v })} />}
				/>
				<SectionTitle>Agent</SectionTitle>
				<div className="mt-2 flex gap-2">
					<div className="flex-1">
						<Label htmlFor="workdir" className="mb-1.5 block text-xs">Working Directory</Label>
						<Input
							id="workdir"
							placeholder="e.g. C:\Users\you\projects"
							value={settings.workdir}
							onChange={e => onUpdate({ workdir: e.target.value })}
						/>
					</div>
					<Button variant="outline" size="sm" onClick={handleBrowse} className="mt-[25px] h-9 gap-1.5">
						<FolderOpen className="h-3.5 w-3.5" />
						Browse
					</Button>
				</div>
			</div>
		);
	}

	function PersonalizationTab({
		settings, onUpdate, newMemory, setNewMemory, newMemoryType, setNewMemoryType,
		memSearch, setMemSearch, memTypeFilter, setMemTypeFilter, filteredMemories,
		editingMemId, setEditingMemId, editMemVal, setEditMemVal,
		instructionsPreview, setInstructionsPreview,
		onAddMemory, onUpdateMemory, onDeleteMemory, onToggleMemory,
	}: any) {
		const MEM_TYPE_LABELS: Record<string, string> = { user: "User", workspace: "Workspace", agent: "Agent" };

		return (
			<div>
				<SectionTitle first>Identity</SectionTitle>
				<div className="mt-2">
					<Label htmlFor="nickname" className="mb-1.5 block text-xs">Your nickname</Label>
					<Input
						id="nickname"
						placeholder="What should the agent call you?"
						value={settings.nickname}
						onChange={e => onUpdate({ nickname: e.target.value })}
					/>
				</div>

				<SectionTitle>Custom Instructions</SectionTitle>
				<p className="mb-2 text-xs text-muted-foreground">Prepended to every conversation. Markdown supported.</p>
				<div className="mb-2 flex gap-1.5">
					<Button size="sm" variant={!instructionsPreview ? "default" : "outline"} onClick={() => setInstructionsPreview(false)}>Edit</Button>
					<Button size="sm" variant={instructionsPreview ? "default" : "outline"} onClick={() => setInstructionsPreview(true)}>Preview</Button>
				</div>
				{instructionsPreview ? (
							<div className="min-h-[120px] rounded-md border border-border/60 p-3 text-sm leading-6">
								{settings.instructions ? (
									<MarkdownRenderer content={settings.instructions} />
						) : (
							<div className="text-muted-foreground">No instructions set.</div>
						)}
					</div>
				) : (
					<Textarea
						className="min-h-[140px]"
						placeholder="e.g. Always respond in a casual tone. Prefer TypeScript over JavaScript..."
						value={settings.instructions}
						onChange={e => onUpdate({ instructions: e.target.value })}
					/>
				)}

				<SectionTitle>Memory</SectionTitle>
				<p className="mb-2 text-xs text-muted-foreground">
					Memories are injected into every conversation. Manage user, workspace, and agent memories.
				</p>

				<div className="mb-2 flex gap-1">
					{(["all", "user", "workspace", "agent"] as const).map(t => (
						<Button
							key={t}
							size="sm"
							variant={memTypeFilter === t ? "default" : "outline"}
							onClick={() => setMemTypeFilter(t)}
							className="h-7 px-2.5 text-xs"
						>
							{t === "all" ? "All" : MEM_TYPE_LABELS[t]}
						</Button>
					))}
				</div>

				<div className="relative mb-2">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search memories..."
						value={memSearch}
						onChange={e => setMemSearch(e.target.value)}
						className="pl-8"
					/>
				</div>

				<div className="mb-3 flex gap-2">
					<Select value={newMemoryType} onValueChange={(v) => setNewMemoryType(v as MemoryType)}>
						<SelectTrigger className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="user">User</SelectItem>
							<SelectItem value="workspace">Workspace</SelectItem>
							<SelectItem value="agent">Agent</SelectItem>
						</SelectContent>
					</Select>
					<Input
						placeholder="Add a memory..."
						value={newMemory}
						onChange={e => setNewMemory(e.target.value)}
						onKeyDown={e => {
							if (e.key === "Enter" && newMemory.trim()) {
								onAddMemory(newMemory.trim(), newMemoryType);
								setNewMemory("");
							}
						}}
						className="flex-1"
					/>
					<Button
						onClick={() => {
							if (newMemory.trim()) {
								onAddMemory(newMemory.trim(), newMemoryType);
								setNewMemory("");
							}
						}}
					>
						Add
					</Button>
				</div>

				<div className="flex flex-col gap-1.5">
					{filteredMemories.length === 0 && (
						<div className="py-4 text-center text-xs text-muted-foreground">
							{memSearch ? "No memories match" : "No memories saved yet"}
						</div>
					)}
					{filteredMemories.map((m: MemoryEntry) => (
						<div key={m.id} className={cn("rounded-md border border-border p-3", m.enabled === false && "opacity-50")}>
							{editingMemId === m.id ? (
								<div>
									<Textarea
										className="mb-2 min-h-[60px]"
										value={editMemVal}
										onChange={e => setEditMemVal(e.target.value)}
										autoFocus
										onKeyDown={e => {
											if (e.key === "Enter" && !e.shiftKey) {
												onUpdateMemory(m.id, { content: editMemVal });
												setEditingMemId(null);
											}
											if (e.key === "Escape") setEditingMemId(null);
										}}
									/>
									<div className="flex gap-1.5">
										<Button size="sm" onClick={() => { onUpdateMemory(m.id, { content: editMemVal }); setEditingMemId(null); }}>Save</Button>
										<Button size="sm" variant="ghost" onClick={() => setEditingMemId(null)}>Cancel</Button>
									</div>
								</div>
							) : (
								<div className="mb-2 text-sm">{m.content}</div>
							)}
							<div className="flex items-center gap-1.5">
								<Badge variant="outline" className="h-5 px-1.5 text-[0.65rem]">{MEM_TYPE_LABELS[m.type ?? "user"]}</Badge>
								{m.source === "agent" && <Badge variant="outline" className="h-5 px-1.5 text-[0.65rem] text-primary">auto</Badge>}
								<span className="text-xs text-muted-foreground">
									{new Date(m.createdAt).toLocaleDateString()}
								</span>
								<div className="ml-auto flex gap-0.5">
									<Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onToggleMemory(m.id)} title={m.enabled === false ? "Enable" : "Disable"}>
										{m.enabled === false ? <Ban className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
									</Button>
									<Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingMemId(m.id); setEditMemVal(m.content); }} title="Edit">
										<Pencil className="h-3 w-3" />
									</Button>
									<Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => onDeleteMemory(m.id)} title="Delete">
										<Trash2 className="h-3 w-3" />
									</Button>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	function ModelsTab({ settings, onUpdate }: { settings: AppSettings; onUpdate: (u: Partial<AppSettings>) => void }) {
		const providers = [
			{ id: "openai", label: "OpenAI", detail: "GPT models" },
			{ id: "anthropic", label: "Anthropic", detail: "Claude models" },
			{ id: "google", label: "Google", detail: "Gemini models" },
			{ id: "openrouter", label: "OpenRouter", detail: "Free and paid multi-provider models" },
			{ id: "deepseek", label: "DeepSeek", detail: "DeepSeek chat and reasoning models" },
		];
		const [keys, setKeys] = useState<Record<string, string>>({});
		const [connected, setConnected] = useState<Record<string, boolean>>({});
		const [saving, setSaving] = useState<string | null>(null);
		const [keyError, setKeyError] = useState<string | null>(null);
		const [vaultOpen, setVaultOpen] = useState(false);

		async function refreshConnections() {
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				const states = await invoke<Array<{ provider: string; connected: boolean }>>("provider_connections");
				setConnected(Object.fromEntries(states.map((state) => [state.provider, state.connected])));
			} catch {
				setKeyError("Credential vault is unavailable. Run this screen inside Meridian desktop.");
			}
		}

		useEffect(() => { void refreshConnections(); }, []);

		async function saveKey(provider: string) {
			const key = keys[provider]?.trim();
			if (!key) return;
			setSaving(provider);
			setKeyError(null);
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				await invoke("save_provider_key", { provider, apiKey: key });
				setKeys((current) => ({ ...current, [provider]: "" }));
				await refreshConnections();
			} catch (error) {
				setKeyError(error instanceof Error ? error.message : "Could not save this API key.");
			} finally {
				setSaving(null);
			}
		}

		return (
			<div>
				<SectionTitle first>Default Model</SectionTitle>
				<p className="mb-3 text-xs text-muted-foreground">Used for new conversations. Can be overridden per conversation.</p>
				<div className="mb-5 rounded-md border border-border bg-muted/30 p-3">
					<div className="flex items-center justify-between gap-3">
						<div><div className="text-sm font-semibold">Global Default</div><div className="text-xs text-muted-foreground">Currently selected model for all new chats</div></div>
						<ModelPicker value={settings.defaultModel} onChange={(id) => onUpdate({ defaultModel: id })} />
					</div>
				</div>
				<div className="mb-2 flex items-center justify-between">
					<div><SectionTitle first>Local Vault</SectionTitle><p className="text-xs text-muted-foreground">Provider keys and local skill settings stay on this device in secure storage.</p></div>
					<Button size="sm" variant="outline" onClick={() => setVaultOpen((open) => !open)}>{vaultOpen ? "Hide keys" : "Manage keys"}</Button>
				</div>
				{vaultOpen && <div className="divide-y rounded-md border border-border">
					{providers.map((provider) => (
						<div key={provider.id} className="p-3">
							<div className="mb-2 flex items-center gap-2"><div className="flex-1"><div className="text-sm font-semibold">{provider.label}</div><div className="text-xs text-muted-foreground">{provider.detail}</div></div><Badge variant="outline" className={cn("text-[0.65rem]", connected[provider.id] ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{connected[provider.id] ? "Connected" : "Not connected"}</Badge></div>
							<div className="flex gap-2"><Input type="password" autoComplete="off" value={keys[provider.id] ?? ""} onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={connected[provider.id] ? "Replace saved API key" : `Paste ${provider.label} API key`} /><Button size="sm" disabled={!keys[provider.id]?.trim() || saving === provider.id} onClick={() => void saveKey(provider.id)}>{saving === provider.id ? "Saving..." : "Save"}</Button></div>
						</div>
					))}
				</div>}
				{keyError && <p className="mt-2 text-xs text-destructive">{keyError}</p>}
			</div>
		);
	}

function ToolsTab({ settings, onUpdate }: { settings: AppSettings; onUpdate: (u: Partial<AppSettings>) => void }) {
		async function handleBrowseSkills() {
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				const path = await invoke<string | null>("select_directory", { initial: settings.skillsGlobalRoot ?? "" });
				if (path) onUpdate({ skillsGlobalRoot: path });
			} catch (err) {
				console.error("Failed to select directory:", err);
			}
		}

		return (
			<div>
				<SectionTitle>Working Directory</SectionTitle>
				<p className="mb-1 text-xs text-muted-foreground">Control where the agent is allowed to write files.</p>
				<AgentToggleRow
					label="Restrict writes to working directory"
					desc="Block any write, edit, or delete outside the configured working directory"
					field="restrictToWorkingDir"
				/>
				<AgentToggleRow
					label="Confirm writes outside working directory"
					desc="Show an approval prompt before any write outside the working directory (ignored if restriction above is on)"
					field="confirmOutsideWorkingDir"
				/>

				<SectionTitle>Skills</SectionTitle>
				<p className="mb-2 text-xs text-muted-foreground">
					Skills are reusable workflows the agent can activate on demand. The agent always scans <code className="rounded bg-muted px-1 py-0.5 text-[0.65rem]">&lt;workdir&gt;/skills</code> first. Add a global root below to share skills across workspaces. Install more with <code className="rounded bg-muted px-1 py-0.5 text-[0.65rem]">npx skills add &lt;owner/repo&gt;</code> from <a href="https://skills.sh" target="_blank" rel="noreferrer" className="underline">skills.sh</a>.
				</p>
				<div className="mt-2 flex gap-2">
					<div className="flex-1">
						<Label htmlFor="skillsGlobalRoot" className="mb-1.5 block text-xs">Global Skills Root (optional)</Label>
						<Input
							id="skillsGlobalRoot"
							placeholder="e.g. C:\Users\you\.meridian\skills"
							value={settings.skillsGlobalRoot ?? ""}
							onChange={e => onUpdate({ skillsGlobalRoot: e.target.value })}
						/>
					</div>
					<Button variant="outline" size="sm" onClick={handleBrowseSkills} className="mt-[25px] h-9 gap-1.5">
						<FolderOpen className="h-3.5 w-3.5" />
						Browse
					</Button>
				</div>

				<CommandRulesSection settings={settings} onUpdate={onUpdate} />
			</div>
		);
	}

	function CommandRulesSection({ settings, onUpdate }: { settings: AppSettings; onUpdate: (u: Partial<AppSettings>) => void }) {
		const rules = settings.commandRules ?? [];
		const [pattern, setPattern] = useState("");
		const [match, setMatch] = useState<"exact" | "prefix" | "base">("base");
		const [action, setAction] = useState<"approve" | "deny">("approve");

		function add() {
			const p = pattern.trim();
			if (!p) return;
			const next = [...rules, { id: crypto.randomUUID(), pattern: p, match, action, createdAt: Date.now() }];
			onUpdate({ commandRules: next });
			setPattern("");
		}
		function remove(id: string) {
			onUpdate({ commandRules: rules.filter(r => r.id !== id) });
		}
		function moveUp(idx: number) {
			if (idx <= 0) return;
			const next = [...rules];
			[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
			onUpdate({ commandRules: next });
		}

		const matchLabels: Record<"exact" | "prefix" | "base", string> = {
			exact: "Full command",
			prefix: "Starts with",
			base: "Base command",
		};
		const matchHints: Record<"exact" | "prefix" | "base", string> = {
			exact: "Matches only when the full command text equals the pattern (e.g. \"npm install\" matches only \"npm install\").",
			prefix: "Matches when the command starts with the pattern (e.g. \"git pull\" matches \"git pull\", \"git pull origin main\").",
			base: "Matches when the first word equals the pattern (e.g. \"npm\" matches any npm command).",
		};

		return (
			<>
				<SectionTitle>Command Rules</SectionTitle>
				<p className="mb-2 text-xs text-muted-foreground">
					Auto-approve or auto-deny shell commands without prompting. Rules are checked in order â€” the first match wins. Only applies when run-command approval is enabled above.
				</p>

				<div className="mb-3 rounded-md border border-border bg-muted/20 p-2.5">
					<div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-2">
						<Input
							placeholder={match === "base" ? "e.g. npm" : match === "prefix" ? "e.g. git pull" : "e.g. npm install"}
							value={pattern}
							onChange={e => setPattern(e.target.value)}
							onKeyDown={e => { if (e.key === "Enter") add(); }}
							className="h-8 text-xs"
						/>
						<Select value={match} onValueChange={(v) => setMatch(v as any)}>
							<SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="base">Base command</SelectItem>
								<SelectItem value="prefix">Starts with</SelectItem>
								<SelectItem value="exact">Full command</SelectItem>
							</SelectContent>
						</Select>
						<Select value={action} onValueChange={(v) => setAction(v as any)}>
							<SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="approve">Approve</SelectItem>
								<SelectItem value="deny">Deny</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="text-[0.65rem] leading-tight text-muted-foreground">{matchHints[match]}</span>
						<Button size="sm" className="h-7 px-3 text-xs" onClick={add} disabled={!pattern.trim()}>Add rule</Button>
					</div>
				</div>

				<div className="flex flex-col gap-1">
					{rules.length === 0 && (
						<div className="py-3 text-center text-xs text-muted-foreground">No command rules yet.</div>
					)}
					{rules.map((r, idx) => (
						<div key={r.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
							<Badge
								variant="outline"
								className={cn(
									"h-5 shrink-0 px-1.5 text-[0.6rem] font-semibold uppercase",
									r.action === "approve"
										? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
										: "border-destructive/30 bg-destructive/10 text-destructive",
								)}
							>
								{r.action === "approve" ? "Allow" : "Block"}
							</Badge>
							<span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-muted-foreground">{matchLabels[r.match]}</span>
							<code className="min-w-0 flex-1 truncate font-mono text-xs">{r.pattern}</code>
							<Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => moveUp(idx)} disabled={idx === 0} title="Move up">â†‘</Button>
							<Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => remove(r.id)} title="Delete">
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						</div>
					))}
				</div>
			</>
		);
	}

	function CustomizationTab({ settings, onUpdate }: { settings: AppSettings; onUpdate: (u: Partial<AppSettings>) => void }) {
		const currentTheme: ShadcnTheme = (settings.theme as ShadcnTheme) ?? "neutral";
		const currentMode: ColorMode = settings.mode ?? getMode();

		function pickTheme(theme: ShadcnTheme) {
			applyTheme(theme, currentMode);
			onUpdate({ theme });
		}
		function pickMode(mode: ColorMode) {
			applyTheme(currentTheme, mode);
			onUpdate({ mode });
		}

		return (
			<div>
				<SectionTitle first>Appearance</SectionTitle>
				<p className="mb-3 text-xs text-muted-foreground">Switch between light and dark mode.</p>
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => pickMode("light")}
						className={cn(
							"relative flex items-center gap-2 rounded-md border bg-card px-3 py-2.5 text-left transition-colors",
							currentMode === "light" ? "border-primary" : "border-border hover:border-primary/50"
						)}
					>
						<Sun className="h-4 w-4" />
						<span className="text-sm font-medium">Light</span>
						{currentMode === "light" && <Check className="ml-auto h-4 w-4 text-primary" />}
					</button>
					<button
						type="button"
						onClick={() => pickMode("dark")}
						className={cn(
							"relative flex items-center gap-2 rounded-md border bg-card px-3 py-2.5 text-left transition-colors",
							currentMode === "dark" ? "border-primary" : "border-border hover:border-primary/50"
						)}
					>
						<Moon className="h-4 w-4" />
						<span className="text-sm font-medium">Dark</span>
						{currentMode === "dark" && <Check className="ml-auto h-4 w-4 text-primary" />}
					</button>
				</div>

				<SectionTitle>Theme</SectionTitle>
				<p className="mb-3 text-xs text-muted-foreground">Pick a color palette. All themes support both light and dark mode.</p>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
					{SHADCN_THEMES.map(t => {
						const swatch = currentMode === "dark" ? t.primaryDark : t.primary;
						const selected = currentTheme === t.id;
						return (
							<button
								key={t.id}
								type="button"
								onClick={() => pickTheme(t.id)}
								className={cn(
									"relative flex items-center gap-2.5 rounded-md border bg-card px-3 py-2 text-left transition-colors",
									selected ? "border-primary" : "border-border hover:border-primary/50"
								)}
							>
								<span
									className="h-5 w-5 shrink-0 rounded-full border border-border"
									style={{ backgroundColor: swatch }}
								/>
								<span className="text-sm font-medium">{t.label}</span>
								{selected && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
							</button>
						);
					})}
				</div>

				<SectionTitle>Layout</SectionTitle>
				<SettingRow
					label="Compact mode"
					desc="Reduce spacing and padding throughout the UI"
					control={<Switch checked={!!settings.compactMode} onCheckedChange={(v) => onUpdate({ compactMode: v })} />}
				/>
				<AgentToggleRow
					label="Compact tool cards"
					desc="Collapse read-only tool calls (read-file, list-directory) into a single line"
					field="compactReadTools"
				/>
				<SettingRow
					label="Font size"
					desc="Chat message font size"
					control={
						<div className="flex items-center gap-2">
							<Button size="sm" variant="outline" onClick={() => onUpdate({ fontSize: Math.max(11, settings.fontSize - 1) })} className="h-7 w-7 p-0">âˆ’</Button>
							<span className="min-w-10 text-center text-sm">{settings.fontSize}px</span>
							<Button size="sm" variant="outline" onClick={() => onUpdate({ fontSize: Math.min(20, settings.fontSize + 1) })} className="h-7 w-7 p-0">+</Button>
						</div>
					}
				/>
			</div>
		);
	}

	function AdvancedTab({ settings, onUpdate: _onUpdate }: { settings: AppSettings; onUpdate: (u: Partial<AppSettings>) => void }) {
		const [appVersion, setAppVersion] = useState("...");
		const [showClearModal, setShowClearModal] = useState(false);
		const [clearInput, setClearInput] = useState("");
		const [clearing, setClearing] = useState(false);
		const [clearError, setClearError] = useState<string | null>(null);
		const CONFIRM_PHRASE = "delete my data";

		type ClearKey =
			| "conversations"
			| "trash"
			| "archive"
			| "workspaces"
			| "memories"
			| "settings";

		const [clearTargets, setClearTargets] = useState<Record<ClearKey, boolean>>({
			conversations: true,
			trash: true,
			archive: true,
			workspaces: true,
			memories: true,
			settings: true,
		});

		const CLEAR_ITEMS: { key: ClearKey; label: string; desc: string }[] = [
			{ key: "conversations", label: "Active conversations", desc: "All non-archived, non-trashed chats" },
			{ key: "trash", label: "Trash", desc: "Soft-deleted conversations awaiting purge" },
			{ key: "archive", label: "Archive", desc: "Archived conversations" },
			{ key: "workspaces", label: "Workspaces", desc: "Custom workspaces (Personal default is recreated)" },
			{ key: "memories", label: "Memories", desc: "Saved user, workspace, and agent memories" },
			{ key: "settings", label: "App settings", desc: "Theme, font size, approvals, MCP servers, etc." },
		];

		const anySelected = Object.values(clearTargets).some(Boolean);

		useEffect(() => {
			import("@tauri-apps/api/core").then(({ invoke }) =>
				invoke<string>("get_app_version").then(v => setAppVersion(v)).catch(() => setAppVersion("0.1.0"))
			);
		}, []);

		function exportData() {
			const data = { settings, exportedAt: new Date().toISOString() };
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url; a.download = "meridian-settings.json"; a.click();
			URL.revokeObjectURL(url);
		}

		function readConversations(): any[] {
			try {
				const raw = localStorage.getItem("conversations");
				if (!raw) return [];
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed : [];
			} catch { return []; }
		}

		async function wipeConversationFiles(predicate: (c: any) => boolean): Promise<void> {
			try {
				const fs = await import("@tauri-apps/plugin-fs");
				const { BaseDirectory } = await import("@tauri-apps/api/path");
				const hasDir = await fs.exists("conversations", { baseDir: BaseDirectory.AppData });
				if (!hasDir) return;
				const entries = await fs.readDir("conversations", { baseDir: BaseDirectory.AppData });
				for (const entry of entries) {
					if (!entry.isFile || !entry.name.endsWith(".json")) continue;
					try {
						const content = await fs.readTextFile("conversations/" + entry.name, { baseDir: BaseDirectory.AppData });
						const parsed = JSON.parse(content);
						if (predicate(parsed)) {
							await fs.remove("conversations/" + entry.name, { baseDir: BaseDirectory.AppData });
						}
					} catch {
						if (predicate({ deleted: false, archived: false })) {
							try { await fs.remove("conversations/" + entry.name, { baseDir: BaseDirectory.AppData }); } catch {}
						}
					}
				}
			} catch (err) {
				console.error("[clear-data] failed to wipe conversation files", err);
				throw err;
			}
		}

		async function doClear() {
			if (!anySelected || clearInput !== CONFIRM_PHRASE) return;
			setClearing(true);
			setClearError(null);
			try {
				const wantsActive = clearTargets.conversations;
				const wantsTrash = clearTargets.trash;
				const wantsArchive = clearTargets.archive;

				if (wantsActive || wantsTrash || wantsArchive) {
					await wipeConversationFiles((c: any) => {
						if (c?.deleted) return wantsTrash;
						if (c?.archived) return wantsArchive;
						return wantsActive;
					});
				}

				if (wantsActive && wantsTrash && wantsArchive) {
					localStorage.removeItem("conversations");
				} else {
					try {
						const all = readConversations();
						const kept = all.filter((c: any) => {
							if (c?.deleted) return !wantsTrash;
							if (c?.archived) return !wantsArchive;
							return !wantsActive;
						});
						if (kept.length === 0) localStorage.removeItem("conversations");
						else localStorage.setItem("conversations", JSON.stringify(kept));
					} catch {}
				}

				if (clearTargets.workspaces) {
					localStorage.removeItem("workspaces");
					localStorage.removeItem("activeWsId");
				}

				if (clearTargets.settings) {
					localStorage.removeItem("settings");
				} else if (clearTargets.memories) {
					try {
						const raw = localStorage.getItem("settings");
						if (raw) {
							const s = JSON.parse(raw);
							s.memories = [];
							localStorage.setItem("settings", JSON.stringify(s));
						}
					} catch {}
				}

				if (wantsActive || wantsTrash || wantsArchive) {
					localStorage.removeItem("activeConvId");
				}

				location.reload();
			} catch (err) {
				setClearError(err instanceof Error ? err.message : String(err));
				setClearing(false);
			}
		}

		return (
			<div>
				<Dialog open={showClearModal} onOpenChange={(o) => { if (!o && !clearing) { setShowClearModal(false); setClearInput(""); setClearError(null); } }}>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle>Clear local data</DialogTitle>
						</DialogHeader>
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								Pick what to wipe. Selected items will be permanently deleted from both browser storage and disk. The app reloads when done.
							</p>
							<div className="rounded-md border border-border">
								{CLEAR_ITEMS.map((item, idx) => (
									<div
										key={item.key}
										className={cn(
											"flex items-start justify-between gap-3 px-3 py-2",
											idx > 0 && "border-t border-border",
										)}
									>
										<div className="min-w-0">
											<div className="text-sm font-medium">{item.label}</div>
											<div className="text-xs text-muted-foreground">{item.desc}</div>
										</div>
										<Switch
											checked={clearTargets[item.key]}
											onCheckedChange={(v) => setClearTargets(prev => ({ ...prev, [item.key]: v }))}
										/>
									</div>
								))}
							</div>
							<p className="text-sm">
								Type <strong>delete my data</strong> to confirm.
							</p>
							<Input
								value={clearInput}
								onChange={e => setClearInput(e.target.value)}
								placeholder="delete my data"
								autoFocus
								disabled={clearing}
								onKeyDown={e => {
									if (e.key === "Enter" && clearInput === CONFIRM_PHRASE && anySelected && !clearing) doClear();
									if (e.key === "Escape" && !clearing) { setShowClearModal(false); setClearInput(""); setClearError(null); }
								}}
							/>
							{!anySelected && (
								<p className="text-xs text-amber-600 dark:text-amber-400">Select at least one item to clear.</p>
							)}
							{clearError && (
								<p className="text-xs text-destructive">Failed: {clearError}</p>
							)}
						</div>
						<DialogFooter>
							<Button variant="outline" disabled={clearing} onClick={() => { setShowClearModal(false); setClearInput(""); setClearError(null); }}>Cancel</Button>
							<Button
								variant="destructive"
								disabled={!anySelected || clearInput !== CONFIRM_PHRASE || clearing}
								onClick={doClear}
							>
								{clearing ? "Clearing..." : "Clear selected"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<SectionTitle first>Data</SectionTitle>
				<SettingRow
					label="Export settings"
					desc="Download your settings and memories as JSON"
					control={<Button variant="outline" size="sm" onClick={exportData}>Export</Button>}
				/>
				<SettingRow
					label="Clear local data"
					desc="Selectively delete conversations, trash, archive, workspaces, memories, or settings"
					control={<Button variant="destructive" size="sm" onClick={() => setShowClearModal(true)}>Clear data...</Button>}
				/>
				<SectionTitle>About</SectionTitle>
				<div className="flex flex-col gap-1">
					<p className="text-sm">Meridian <strong>v{appVersion}</strong></p>
					<p className="text-xs text-muted-foreground">Built with Tauri 2 + React 19</p>
					<Button
						variant="link"
						size="sm"
						className="h-auto justify-start p-0 text-sm"
						onClick={async () => {
							const url = "https://github.com/pinkaroo/Meridian/releases";
							try {
								const { openUrl } = await import("@tauri-apps/plugin-opener");
								await openUrl(url);
							} catch {
								window.open(url, "_blank");
							}
						}}
					>
						View releases on GitHub â†—
					</Button>
				</div>
			</div>
		);
	}
