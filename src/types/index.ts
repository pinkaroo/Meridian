export type Role = "user" | "assistant" | "system";

export type ModelTag = "flagship" | "standard" | "fast" | "reasoning";

export type AgentStatus =
	| "idle"
	| "working"
	| "queued"
	| "waiting_approval"
	| "paused"
	| "completed"
	| "failed"
	| "interrupted";

export type ShadcnTheme =
	| "zinc" | "slate" | "stone" | "gray" | "neutral"
	| "red" | "rose" | "orange" | "green" | "blue" | "yellow" | "violet";

export type ColorMode = "light" | "dark";

export interface ModelOption {
	id: string;
	name: string;
	tag: ModelTag;
}

export type MemoryType = "user" | "workspace" | "agent";

export interface MemoryEntry {
	id: string;
	content: string;
	createdAt: number;
	type?: MemoryType;
	workspaceId?: string;
	enabled?: boolean;
	source?: "manual" | "agent";
}

export interface QueuedMessage {
	id: string;
	content: string;
	attachments?: Attachment[];
	createdAt: number;
	mode?: "normal" | "merge" | "websearch";
}

export interface ActivityEvent {
	id: string;
	type: "tool_use" | "file_modified" | "command_exec" | "status_change" | "message" | "approval" | "thinking";
	label: string;
	detail?: string;
	timestamp: number;
}

export interface ApprovalRequest {
	id: string;
	convId: string;
	toolName: string;
	raw: string;
	title: string;
	detail?: string;
	risk: "low" | "medium" | "high";
	createdAt: number;
}

export interface Attachment {
	name: string;
	path?: string;
	size: number;
	mimeType: string;
	isBinary: boolean;
	content: string;
	thumbDataUrl?: string;
}

export interface ConvFile {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	content: string;
	isBinary: boolean;
	createdAt: number;
	source: "user" | "agent";
	path?: string;
}

export interface ToolCallRecord {
	id: string;
	name: string;
	args: Record<string, string>;
	status: "pending" | "running" | "complete" | "error" | "denied";
	startedAt: number;
	finishedAt?: number;
	result?: string;
	label?: string;
}

export interface FileSnapshot {
	path: string;
	content: string | null;
}

export type MessageSegment =
	| { kind: "text"; text: string; sourceId?: string }
	| { kind: "thinking"; text: string; collapsed?: boolean; sourceId?: string }
	| { kind: "tool"; call: ToolCallRecord }
	| {
			kind: "checkpoint";
			checkpointId: string;
			stepNumber: number;
			filesTouched: string[];
			restored?: boolean;
		}
	| {
			kind: "file";
			name: string;
			content: string;
			mimeType: string;
			size: number;
		};

export interface Message {
	id: string;
	role: Role;
	content: string;
	timestamp: number;
	segments?: MessageSegment[];
	attachments?: Attachment[];
	streaming?: boolean;
	elapsedMs?: number;
	memoryAdded?: string;
	bookmarked?: boolean;
	edited?: boolean;
	model?: string;
	chatMode?: "normal" | "merge" | "websearch";
	searchSources?: Array<{ title: string; url: string; snippet: string }>;
}

export interface Conversation {
	id: string;
	title: string;
	messages: Message[];
	workspaceId: string;
	model: string;
	createdAt: number;
	updatedAt: number;
	pinned?: boolean;
	favorited?: boolean;
	archived?: boolean;
	deleted?: boolean;
	deletedAt?: number;
	agentStatus?: AgentStatus;
queue?: QueuedMessage[];
	activity?: ActivityEvent[];
	draft?: string;
	mode?: "agent" | "chat";
	files?: ConvFile[];
}

export interface Workspace {
	id: string;
	name: string;
	color: string;
	icon: string;
	workingDirectory?: string;
	systemPrompt: string;
	instructions?: string;
	notes?: string;
	pinnedFiles?: string[];
	recentFiles?: string[];
	createdAt: number;
}

export interface ApprovalSettings {
	requireRunCommand: boolean;
	requireFileWrite: boolean;
	requireFileDelete: boolean;
	requireNetworkRequest: boolean;
	requireEnvRead: boolean;
	requireFileRead: boolean;
}

export interface CommandRule {
	id: string;
	pattern: string;
	match: "exact" | "prefix" | "base";
	action: "approve" | "deny";
	createdAt: number;
}

export interface AppSettings {
	approvals: ApprovalSettings;
	approvalDefaultsVersion?: number;
	fontSize: number;
	sendOnEnter: boolean;
	workdir: string;
	notifyOnDone: boolean;
	notifyOnApproval: boolean;
	nickname: string;
	instructions: string;
	memories: MemoryEntry[];
	defaultModel: string;
	effort?: "low" | "medium" | "high";
	compactMode?: boolean;
	theme?: ShadcnTheme;
	mode?: ColorMode;
sounds?: boolean;
mcpServers?: McpServer[];
	commandRules?: CommandRule[];
	skillsGlobalRoot?: string;
}

export interface InAppNotification {
	id: string;
	type: "agent_done" | "approval_needed" | "task_done" | "task_failed" | "memory_saved" | "file_modified";
	title: string;
	body: string;
	convId?: string;
	timestamp: number;
	read?: boolean;
}

export type McpTransport = "stdio" | "http" | "sse";

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface McpServer {
	id: string;
	name: string;
	enabled: boolean;
	transport: McpTransport;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	settings?: McpServerSettings;
	tools?: McpTool[];
	status?: "disconnected" | "connecting" | "connected" | "error";
	error?: string;
	autoConnect?: boolean;
	manuallyDisconnected?: boolean;
}

export type CasingStyle = "camelCase" | "PascalCase" | "snake_case" | "UPPER_CASE";

export interface McpServerSettings {
	casing?: CasingStyle;
	includeComments?: boolean;
	maxResults?: number;
	useModuleScripts?: boolean;
}

export interface McpPreset {
	id: string;
	name: string;
	description: string;
	icon: string;
	transport: McpTransport;
	command?: string;
	args?: string[];
	requiresConfig?: Array<{ key: string; label: string; placeholder: string; secret?: boolean }>;
}
