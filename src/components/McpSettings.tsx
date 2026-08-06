import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MCP_PRESETS, mcpConnect, mcpDisconnect } from "../lib/mcp";
import type { McpServer, McpServerSettings, CasingStyle } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
	Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
	X, Plus, Settings as SettingsIcon, Trash2, Gamepad2, FolderTree, Github, Search, Database, HardDrive, Globe2, Brain, Plug,
} from "lucide-react";

interface Props {
	servers: McpServer[];
	onUpdate: (servers: McpServer[]) => void;
	onClose: () => void;
	embedded?: boolean;
}

interface RobloxMcpLaunchInfo {
	mcpBatPath: string;
	studioMcpPath?: string | null;
	configPath: string;
	mcpBatExists: boolean;
}

const CASING_OPTIONS: { value: CasingStyle; label: string }[] = [
	{ value: "camelCase",  label: "camelCase" },
	{ value: "PascalCase", label: "PascalCase" },
	{ value: "snake_case", label: "snake_case" },
	{ value: "UPPER_CASE", label: "UPPER_CASE" },
];

const DEFAULT_SETTINGS: McpServerSettings = {
	casing: "camelCase",
	includeComments: false,
};

const PRESET_ICONS = {
	"roblox-studio": Gamepad2,
	filesystem: FolderTree,
	github: Github,
	"brave-search": Search,
	postgres: Database,
	sqlite: HardDrive,
	puppeteer: Globe2,
	memory: Brain,
	"custom-http": Plug,
} as const;

function PresetIcon({ id, size = "h-5 w-5" }: { id: string; size?: string }) {
	const Icon = PRESET_ICONS[id as keyof typeof PRESET_ICONS] ?? Plug;
	return <Icon className={cn(size, "text-muted-foreground")} strokeWidth={1.6} />;
}

function getRelevantSettings(server: McpServer): Array<keyof McpServerSettings> {
	const base: Array<keyof McpServerSettings> = ["casing", "includeComments"];
	const id = server.id.replace(/-\d{10,}$/, "");
	if (id === "roblox-studio") return [...base, "useModuleScripts"];
	if (id === "postgres" || id === "sqlite" || id === "filesystem" || id === "github" || id === "brave-search") {
		return [...base, "maxResults"];
	}
	return base;
}

function parseCommandArgs(input: string): string[] {
	const args: string[] = [];
	let current = "";
	let quote: "\"" | "'" | null = null;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quote === "\"" && ch === "\\" && i + 1 < input.length && (input[i + 1] === "\"" || input[i + 1] === "\\")) {
			current += input[i + 1]; i += 1; continue;
		}
		if (quote) { if (ch === quote) quote = null; else current += ch; continue; }
		if (ch === "\"" || ch === "'") { quote = ch; continue; }
		if (/\s/.test(ch)) { if (current) { args.push(current); current = ""; } continue; }
		current += ch;
	}
	if (current) args.push(current);
	return args;
}

function SectionTitle({ children, mt }: { children: React.ReactNode; mt?: string }) {
	return (
		<div className={cn("mb-2 text-[0.7rem] font-bold uppercase tracking-wide text-primary", mt ?? "mt-6")}>
			{children}
		</div>
	);
}

function SettingRow({ label, desc, control }: { label: string; desc?: string; control: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-border py-3 last:border-b-0">
			<div className="min-w-0 pr-4">
				<div className="text-sm font-semibold">{label}</div>
				{desc && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{desc}</div>}
			</div>
			<div className="shrink-0">{control}</div>
		</div>
	);
}

const STATUS_CLASS: Record<string, string> = {
	connected: "bg-emerald-500",
	connecting: "bg-amber-500",
	error: "bg-destructive",
	disconnected: "bg-muted-foreground/50",
};

export default function McpSettings({ servers, onUpdate, onClose, embedded = false }: Props) {
	const mounted = useRef(true);
	useEffect(() => () => { mounted.current = false; }, []);
	const [view, setView] = useState<"list" | "add" | "preset" | "server-settings">("list");
	const [selectedPreset, setSelectedPreset] = useState<typeof MCP_PRESETS[0] | null>(null);
	const [configValues, setConfigValues] = useState<Record<string, string>>({});
	const [connectingId, setConnectingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [editingServerId, setEditingServerId] = useState<string | null>(null);
	const [robloxConfigured, setRobloxConfigured] = useState<boolean | null>(null);
	const [robloxStatus, setRobloxStatus] = useState<string>("");
	const [robloxWriting, setRobloxWriting] = useState(false);

	const [customName, setCustomName] = useState("");
	const [customTransport, setCustomTransport] = useState<"stdio" | "http">("stdio");
	const [customCommand, setCustomCommand] = useState("");
	const [customArgs, setCustomArgs] = useState("");
	const [customUrl, setCustomUrl] = useState("");
	const [customEnv, setCustomEnv] = useState("");
	const serversRef = useRef(servers);

	useEffect(() => { serversRef.current = servers; }, [servers]);

	function updateServers(updater: McpServer[] | ((current: McpServer[]) => McpServer[])) {
		const next = typeof updater === "function" ? updater(serversRef.current) : updater;
		serversRef.current = next;
		onUpdate(next);
	}

	useEffect(() => {
		const toConnect = servers.filter(s => s.enabled && s.autoConnect && s.status === "disconnected");
		(async () => {
			for (const srv of toConnect) {
				try { await connectServer(srv, true); } catch { /* per-server error already stored */ }
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function connectServer(server: McpServer, silent = false) {
		if (!silent) setConnectingId(server.id);
		setError(null);
		const patchStatus = (patch: Partial<McpServer>) => {
			// Don't write back after the dialog has unmounted — otherwise a slow
			// connect resolving after close would leave a "connecting" badge
			// stuck in settings forever.
			if (!mounted.current) return;
			updateServers(current => current.map(s => s.id === server.id ? { ...s, ...patch } : s));
		};
		patchStatus({ status: "connecting" });
		try {
			const tools = await mcpConnect(server);
			patchStatus({ status: "connected", tools, error: undefined });
		} catch (err: unknown) {
			const msg = String(err);
			patchStatus({ status: "error", error: msg });
			if (!silent && mounted.current) setError(msg);
			throw err;
		} finally {
			if (!silent && mounted.current) setConnectingId(null);
		}
	}

	async function disconnectServer(server: McpServer) {
		await mcpDisconnect(server);
		updateServers(current => current.map(s => s.id === server.id
			? { ...s, status: "disconnected" as const, tools: undefined }
			: s
		));
	}

	function toggleEnabled(id: string) {
		updateServers(current => current.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
	}

	function toggleAutoConnect(id: string) {
		updateServers(current => current.map(s => s.id === id ? { ...s, autoConnect: !s.autoConnect } : s));
	}

	function removeServer(id: string) {
		const srv = serversRef.current.find(s => s.id === id);
		if (srv) mcpDisconnect(srv).catch(() => {});
		updateServers(current => current.filter(s => s.id !== id));
	}

	function updateServerSettings(id: string, patch: Partial<McpServerSettings>) {
		updateServers(current => current.map(s => s.id === id
			? { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings, ...patch } }
			: s
		));
	}

	useEffect(() => {
		if (selectedPreset?.id === "roblox-studio") {
			setRobloxConfigured(null);
			setRobloxStatus("");
			Promise.all([
				invoke<string>("read_roblox_mcp_config").catch(() => ""),
				invoke<RobloxMcpLaunchInfo>("roblox_mcp_launch_info").catch(() => null),
			])
				.then(([content, info]) => {
					const hasConfig = content.includes('"Roblox_Studio"') || content.includes("mcp.bat");
					const ready = hasConfig && !!info?.mcpBatExists;
					setRobloxConfigured(ready);
					if (ready) {
						setRobloxStatus(`Ready: ${info?.mcpBatPath ?? "%LOCALAPPDATA%\\Roblox\\mcp.bat"}`);
					} else if (info?.studioMcpPath) {
						setRobloxStatus("Roblox Studio MCP was found. Click Auto-configure to create the missing launcher file.");
					} else {
						setRobloxStatus("Roblox Studio MCP was not found. Open or update Roblox Studio once, then try again.");
					}
				})
				.catch(() => {
					setRobloxConfigured(false);
					setRobloxStatus("Could not inspect Roblox Studio MCP setup.");
				});
		}
	}, [selectedPreset]);

	async function handleWriteRobloxConfig() {
		setRobloxWriting(true);
		try {
			await invoke("write_roblox_mcp_config");
			const info = await invoke<RobloxMcpLaunchInfo>("roblox_mcp_launch_info").catch(() => null);
			setRobloxConfigured(true);
			setRobloxStatus(`Ready: ${info?.mcpBatPath ?? "%LOCALAPPDATA%\\Roblox\\mcp.bat"}`);
		} catch (err: unknown) {
			setError(String(err));
			setRobloxConfigured(false);
		} finally {
			setRobloxWriting(false);
		}
	}

	function addFromPreset() {
		if (!selectedPreset) return;
		const id = selectedPreset.id;
		const args = (selectedPreset.args ?? []).map(a =>
			a.replace(/\{(\w+)\}/g, (_, key) => configValues[key] ?? a)
		);
		const env: Record<string, string> = {};
		for (const cfg of selectedPreset.requiresConfig ?? []) {
			if ((cfg as { secret?: boolean }).secret) env[cfg.key] = configValues[cfg.key] ?? "";
		}
		const presetSettings: McpServerSettings = { ...DEFAULT_SETTINGS };
		if (selectedPreset.id === "roblox-studio") presetSettings.useModuleScripts = false;

		const newServer: McpServer = {
			id,
			name: selectedPreset.name,
			enabled: true,
			autoConnect: false,
			transport: selectedPreset.transport,
			command: selectedPreset.command,
			args,
			env: Object.keys(env).length > 0 ? env : undefined,
			url: configValues["url"] || undefined,
			status: "disconnected",
			settings: presetSettings,
		};
		updateServers(current => {
			const existingIdx = current.findIndex(s => s.id === selectedPreset.id);
			if (existingIdx >= 0) {
				const updated = [...current];
				updated[existingIdx] = { ...newServer, tools: undefined };
				return updated;
			}
			return [...current, newServer];
		});
		setView("list");
		setSelectedPreset(null);
		setConfigValues({});
	}

	function addCustom() {
		if (!customName.trim()) return;
		const envMap: Record<string, string> = {};
		customEnv.split("\n").forEach(line => {
			const [k, ...v] = line.split("=");
			if (k?.trim()) envMap[k.trim()] = v.join("=").trim();
		});
		const newSrv: McpServer = {
			id: "custom-" + Date.now(),
			name: customName.trim(),
			enabled: true,
			autoConnect: false,
			transport: customTransport,
			command: customTransport === "stdio" ? customCommand : undefined,
			args: customTransport === "stdio" ? parseCommandArgs(customArgs) : undefined,
			env: Object.keys(envMap).length > 0 ? envMap : undefined,
			url: customTransport === "http" ? customUrl : undefined,
			status: "disconnected",
			settings: { ...DEFAULT_SETTINGS },
		};
		updateServers(current => [...current, newSrv]);
		setView("list");
		setCustomName(""); setCustomCommand(""); setCustomArgs(""); setCustomUrl(""); setCustomEnv("");
	}

	const editingServer = editingServerId ? servers.find(s => s.id === editingServerId) : null;
	const closeView = () => {
		if (embedded && view !== "list") {
			setView("list");
			setSelectedPreset(null);
			setEditingServerId(null);
		} 
		else onClose();
	};

	const body = (
		<>
				{(!embedded || view !== "list") && <DialogHeader className="border-b border-border px-6 py-4">
					<DialogTitle>MCP Servers</DialogTitle>
					<DialogDescription>Model Context Protocol — connect external tools and data sources</DialogDescription>
				</DialogHeader>}

				<ScrollArea className={embedded && view === "list" ? "h-auto max-h-none overflow-visible" : "max-h-[calc(85vh-80px)]"}>
					<div className={embedded && view === "list" ? "px-0 pb-2" : "px-6 py-4"}>
						{error && (
							<div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
								<span className="flex-1">{error}</span>
								<button type="button" onClick={() => setError(null)} className="shrink-0 rounded p-0.5 hover:bg-destructive/20">
									<X className="h-3.5 w-3.5" />
								</button>
							</div>
						)}

						{view === "list" && (
							<>
								{servers.length === 0 ? (
									<div className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card px-4 py-4 text-muted-foreground">
										<span className="text-sm text-foreground">No MCP servers configured</span>
										<span className="text-xs">Add a server to connect external tools</span>
									</div>
								) : (
									<div className="flex flex-col gap-2">
										{servers.map(srv => (
											<div key={srv.id} className={cn(
												"rounded-md border bg-card p-3",
												srv.status === "error" ? "border-destructive" : "border-border",
											)}>
												<div className="flex items-center gap-3">
													<span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_CLASS[srv.status ?? "disconnected"])} />
													<div className="min-w-0 flex-1">
														<div className="truncate text-sm font-semibold">{srv.name}</div>
														<div className="truncate text-xs text-muted-foreground">
															{srv.transport === "stdio" ? (srv.command ?? "") : (srv.url ?? "")}
															{srv.tools ? ` · ${srv.tools.length} tools` : ""}
															{srv.autoConnect ? " · auto-connect" : ""}
														</div>
													</div>
													<div className="flex items-center gap-1">
														{(srv.status === "disconnected" || srv.status === "error") && srv.enabled && (
															<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => connectServer(srv)} disabled={connectingId === srv.id}>
																{connectingId === srv.id ? "Connecting…" : "Connect"}
															</Button>
														)}
														{srv.status === "connected" && (
															<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => disconnectServer(srv)}>Disconnect</Button>
														)}
														<Button variant="ghost" size="icon" className="h-7 w-7" title="Settings" onClick={() => { setEditingServerId(srv.id); setView("server-settings"); }}>
															<SettingsIcon className="h-3.5 w-3.5" />
														</Button>
														<Switch checked={srv.enabled} onCheckedChange={() => toggleEnabled(srv.id)} />
														<Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeServer(srv.id)} title="Remove">
															<Trash2 className="h-3.5 w-3.5" />
														</Button>
													</div>
												</div>
												{srv.status === "error" && srv.error && (
													<div className="mt-2 font-mono text-xs text-destructive">{srv.error}</div>
												)}
												{srv.status === "connected" && srv.tools && srv.tools.length > 0 && (
													<div className="mt-2 flex flex-wrap gap-1">
														{srv.tools.map(t => (
															<Badge key={t.name} variant="outline" title={t.description} className="text-[0.65rem]">{t.name}</Badge>
														))}
													</div>
												)}
											</div>
										))}
									</div>
								)}
								<div className="mt-4 flex gap-2">
									<Button onClick={() => setView("preset")} className="gap-1.5">
										<Plus className="h-4 w-4" /> Add from catalog
									</Button>
									<Button variant="outline" onClick={() => setView("add")}>Custom server</Button>
								</div>
							</>
						)}

						{view === "server-settings" && editingServer && (
							<>
								<div className="mb-3">
									<div className="text-base font-semibold">{editingServer.name}</div>
									<div className="text-xs text-muted-foreground">
										{editingServer.status === "connected" ? `${editingServer.tools?.length ?? 0} tools connected` : editingServer.status}
									</div>
								</div>

								<SectionTitle mt="mt-0">Connection</SectionTitle>
								<SettingRow
									label="Auto-connect on startup"
									desc="Automatically reconnect when Meridian opens"
									control={<Switch checked={!!editingServer.autoConnect} onCheckedChange={() => toggleAutoConnect(editingServer.id)} />}
								/>

								<SectionTitle>Code Generation</SectionTitle>
								<SettingRow
									label="Naming convention"
									desc="Casing style for identifiers in generated code"
									control={
										<Select
											value={editingServer.settings?.casing ?? "camelCase"}
											onValueChange={(v) => updateServerSettings(editingServer.id, { casing: v as CasingStyle })}
										>
											<SelectTrigger className="h-8 w-[140px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{CASING_OPTIONS.map(opt => (
													<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
												))}
											</SelectContent>
										</Select>
									}
								/>
								<SettingRow
									label="Include comments"
									desc="Add descriptive comments to generated code (off = concise output)"
									control={
										<Switch
											checked={!!editingServer.settings?.includeComments}
											onCheckedChange={(v) => updateServerSettings(editingServer.id, { includeComments: v })}
										/>
									}
								/>

								{getRelevantSettings(editingServer).includes("useModuleScripts") && (
									<>
										<SectionTitle>Roblox Studio</SectionTitle>
										<SettingRow
											label="Prefer ModuleScript"
											desc="Use ModuleScript instead of Script/LocalScript where appropriate"
											control={
												<Switch
													checked={!!editingServer.settings?.useModuleScripts}
													onCheckedChange={(v) => updateServerSettings(editingServer.id, { useModuleScripts: v })}
												/>
											}
										/>
									</>
								)}

								{getRelevantSettings(editingServer).includes("maxResults") && (
									<>
										<SectionTitle>Search & Data</SectionTitle>
										<SettingRow
											label="Max results"
											desc="Limit results returned by search/list tools"
											control={
												<Input
													type="number"
													value={editingServer.settings?.maxResults ?? 20}
													onChange={(e) => updateServerSettings(editingServer.id, { maxResults: Number(e.target.value) })}
													min={1}
													max={100}
													className="h-8 w-[90px]"
												/>
											}
										/>
									</>
								)}
							</>
						)}

						{view === "preset" && (
							<>
								{!selectedPreset ? (
									<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
										{MCP_PRESETS.map(p => (
											<button
												key={p.id}
												type="button"
												onClick={() => { setSelectedPreset(p); setConfigValues({}); }}
												className="flex flex-col items-start gap-1 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
											>
												<PresetIcon id={p.id} />
												<span className="text-sm font-semibold">{p.name}</span>
												<span className="text-xs text-muted-foreground">{p.description}</span>
											</button>
										))}
									</div>
								) : (
									<div>
										<div className="mb-3 flex items-center gap-2">
										<PresetIcon id={selectedPreset.id} size="h-6 w-6" />
											<div>
												<div className="text-base font-semibold">{selectedPreset.name}</div>
												<div className="text-xs text-muted-foreground">{selectedPreset.description}</div>
											</div>
										</div>
										{selectedPreset.id === "roblox-studio" && (
											<div className={cn(
												"mb-3 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm",
												robloxConfigured === true ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-sky-500/30 bg-sky-500/10 text-sky-500",
											)}>
												<div className="flex-1">
													{robloxConfigured === true ? (
														<>Roblox Studio MCP is ready. <code className="font-mono text-xs">{robloxStatus}</code></>
													) : (
														robloxStatus || "Write Roblox Studio MCP config and launcher files."
													)}
												</div>
												{robloxConfigured !== true && (
													<Button size="sm" variant="outline" onClick={handleWriteRobloxConfig} disabled={robloxWriting} className="h-7 px-2 text-xs">
														{robloxWriting ? "Writing…" : "Auto-configure"}
													</Button>
												)}
											</div>
										)}
										<div className="flex flex-col gap-2">
											{(selectedPreset.requiresConfig ?? []).map(cfg => (
												<div key={cfg.key} className="flex flex-col gap-1">
													<Label htmlFor={`cfg-${cfg.key}`}>{cfg.label}</Label>
													<Input
														id={`cfg-${cfg.key}`}
														type={"secret" in cfg && cfg.secret ? "password" : "text"}
														placeholder={cfg.placeholder}
														value={configValues[cfg.key] ?? ""}
														onChange={(e) => setConfigValues(prev => ({ ...prev, [cfg.key]: e.target.value }))}
													/>
												</div>
											))}
											{!(selectedPreset.requiresConfig ?? []).length && (
												<div className="text-sm text-muted-foreground">No configuration required.</div>
											)}
											<Button onClick={addFromPreset} className="self-start">
												Add {selectedPreset.name}
											</Button>
										</div>
									</div>
								)}
							</>
						)}

						{view === "add" && (
							<>
								<div className="flex flex-col gap-3">
									<div className="flex flex-col gap-1">
										<Label htmlFor="srv-name">Server name</Label>
										<Input id="srv-name" placeholder="My MCP Server" value={customName} onChange={(e) => setCustomName(e.target.value)} />
									</div>
									<div className="flex flex-col gap-1">
										<Label>Transport</Label>
										<Select value={customTransport} onValueChange={(v) => setCustomTransport(v as "stdio" | "http")}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="stdio">stdio (spawn process)</SelectItem>
												<SelectItem value="http">HTTP / SSE</SelectItem>
											</SelectContent>
										</Select>
									</div>
									{customTransport === "stdio" ? (
										<>
											<div className="flex flex-col gap-1">
												<Label htmlFor="srv-cmd">Command</Label>
												<Input id="srv-cmd" placeholder="cmd.exe, node, python…" value={customCommand} onChange={(e) => setCustomCommand(e.target.value)} />
											</div>
											<div className="flex flex-col gap-1">
												<Label htmlFor="srv-args">Arguments (space-separated)</Label>
												<Input id="srv-args" placeholder="/c npx -y @my/mcp-server" value={customArgs} onChange={(e) => setCustomArgs(e.target.value)} />
											</div>
											<div className="flex flex-col gap-1">
												<Label htmlFor="srv-env">Environment variables (KEY=VALUE, one per line)</Label>
												<Textarea id="srv-env" rows={3} placeholder={"API_KEY=abc123\nDEBUG=1"} value={customEnv} onChange={(e) => setCustomEnv(e.target.value)} />
											</div>
										</>
									) : (
										<div className="flex flex-col gap-1">
											<Label htmlFor="srv-url">Server URL</Label>
											<Input id="srv-url" placeholder="http://localhost:3000/mcp" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
										</div>
									)}
									<Button onClick={addCustom} disabled={!customName.trim()} className="self-start">Add server</Button>
								</div>
							</>
						)}
					</div>
				</ScrollArea>
		</>
	);
	return embedded && view === "list" ? <div className="min-h-full w-full">{body}</div> : (
		<Dialog open={embedded ? view !== "list" : true} onOpenChange={(o) => { if (!o) closeView(); }}>
			<DialogContent className="max-h-[85vh] max-w-2xl gap-0 overflow-hidden p-0">{body}</DialogContent>
		</Dialog>
	);
}
