
import { invoke } from "@tauri-apps/api/core";
import type { McpServer, McpTool } from "../types";

export interface McpToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

interface McpProcessState {
  running: boolean;
  initialized: boolean;
}

const ROBLOX_NO_TOOLS_MESSAGE =
  "Roblox Studio returned no tools. Open a place in Edit mode, enable Assistant > Manage MCP Servers > Enable Studio as MCP server, and retry. If it still returns no tools, enable Game Settings > Security > Allow HTTP Requests, then restart Studio.";

// Roblox sometimes reports an empty tools/list briefly even though the stdio
// session is initialized and Studio shows the client as connected. Keep the
// documented tool names available so the agent can still issue calls while
// Studio finishes refreshing its catalog.
const ROBLOX_TOOL_NAMES = [
  "script_read", "multi_edit", "script_search", "script_grep", "execute_luau",
  "search_game_tree", "inspect_instance", "get_studio_state", "start_stop_play",
  "get_console_output", "screen_capture", "list_roblox_studios", "set_active_studio",
];
let robloxToolsCache: { at: number; tools: McpTool[] } | null = null;

function isRobloxServer(server: McpServer): boolean {
  return server.id.toLowerCase().startsWith("roblox");
}

function isRobloxNoToolsError(err: unknown): boolean {
  return err instanceof Error && err.message === ROBLOX_NO_TOOLS_MESSAGE;
}

async function getMcpProcessState(serverId: string): Promise<McpProcessState> {
  return invoke<McpProcessState>("mcp_process_state", { serverId }).catch(() => ({
    running: false,
    initialized: false,
  }));
}

async function discoverToolsWithRetry(
  call: () => Promise<{ tools?: McpTool[] }>,
  shouldRetryEmpty: boolean,
): Promise<McpTool[]> {
  const attempts = shouldRetryEmpty ? 2 : 1;
  let tools: McpTool[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await call();
    tools = result?.tools ?? [];
    if (tools.length > 0 || attempt === attempts - 1) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return tools;
}


export const MCP_PRESETS = [
  {
    id: "roblox-studio",
    name: "Roblox Studio",
    description: "Control Roblox Studio — read/write scripts, manage instances, run commands in Studio",
    icon: "🎮",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "%LOCALAPPDATA%\\Roblox\\mcp.bat"],
    requiresConfig: [],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Enhanced file operations beyond the built-in tools",
    icon: "ðŸ“",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "npx -y @modelcontextprotocol/server-filesystem {rootPath}"],
    requiresConfig: [
      { key: "rootPath", label: "Root path", placeholder: "C:\\Users\\you\\projects" },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Read repos, issues, PRs, and code via GitHub API",
    icon: "ðŸ™",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "npx -y @modelcontextprotocol/server-github"],
    requiresConfig: [
      { key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Personal Access Token", placeholder: "ghp_...", secret: true },
    ],
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web search via Brave Search API",
    icon: "ðŸ”",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "npx -y @modelcontextprotocol/server-brave-search"],
    requiresConfig: [
      { key: "BRAVE_API_KEY", label: "Brave Search API Key", placeholder: "BSA...", secret: true },
    ],
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query and inspect PostgreSQL databases",
    icon: "ðŸ˜",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "npx -y @modelcontextprotocol/server-postgres {connectionString}"],
    requiresConfig: [
      { key: "connectionString", label: "Connection string", placeholder: "postgresql://user:pass@localhost/db" },
    ],
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Read and query SQLite database files",
    icon: "ðŸ—„",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "npx -y @modelcontextprotocol/server-sqlite --db-path {dbPath}"],
    requiresConfig: [
      { key: "dbPath", label: "Database file path", placeholder: "C:\\data\\mydb.sqlite" },
    ],
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Control a browser — navigate, screenshot, interact with web pages",
    icon: "ðŸŒ",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "npx -y @modelcontextprotocol/server-puppeteer"],
    requiresConfig: [],
  },
  {
    id: "memory",
    name: "MCP Memory",
    description: "Persistent knowledge graph memory across sessions",
    icon: "ðŸ§ ",
    transport: "stdio" as const,
    command: "cmd.exe",
    args: ["/c", "npx -y @modelcontextprotocol/server-memory"],
    requiresConfig: [],
  },
  {
    id: "custom-http",
    name: "Custom HTTP",
    description: "Connect to any MCP server over HTTP or SSE",
    icon: "ðŸ”Œ",
    transport: "http" as const,
    requiresConfig: [
      { key: "url", label: "Server URL", placeholder: "http://localhost:3000/mcp" },
    ],
  },
];


let _rpcId = 1;
function nextId() { return _rpcId++; }

function makeRequest(method: string, params?: unknown) {
  return { jsonrpc: "2.0", id: nextId(), method, params: params ?? {} };
}

function makeNotification(method: string, params?: unknown) {
  return { jsonrpc: "2.0", method, params: params ?? {} };
}


async function httpCall(url: string, method: string, params?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makeRequest(method, params)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json.result;
}

async function httpNotify(url: string, method: string, params?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makeNotification(method, params)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}


async function stdioCall(serverId: string, method: string, params?: unknown): Promise<unknown> {
  const call = invoke<unknown>("mcp_call", { serverId, method, params: params ?? {} });
  return Promise.race([
    call,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 12000)),
  ]);
}

async function stdioNotify(serverId: string, method: string, params?: unknown): Promise<void> {
  await invoke("mcp_notify", {
    serverId,
    method,
    params: params ?? {},
  });
}


export async function mcpConnect(server: McpServer, allowRecovery = true): Promise<McpTool[]> {
  if (server.transport === "stdio") {
    const isRoblox = isRobloxServer(server);
    if (isRoblox && robloxToolsCache && Date.now() - robloxToolsCache.at < 30000) return robloxToolsCache.tools;
    try {
      let processState = isRoblox
        ? await getMcpProcessState(server.id)
        : { running: false, initialized: false };

      if (!processState.running) {
        await invoke("mcp_spawn", {
          serverId: server.id,
          command: server.command ?? "",
          args: server.args ?? [],
          env: server.env ?? {},
        });
        processState = { running: true, initialized: false };
      }

      if (!processState.initialized) {
        await stdioCall(server.id, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "Meridian", version: "1.0.0" },
        });
        await stdioNotify(server.id, "notifications/initialized", {});
      }

      const tools = await discoverToolsWithRetry(
        () => stdioCall(server.id, "tools/list", {}) as Promise<{ tools?: McpTool[] }>,
        isRoblox,
      );
      if (isRoblox && tools.length === 0) {
        return ROBLOX_TOOL_NAMES.map(name => ({ name, description: "Roblox Studio MCP tool", inputSchema: { type: "object", properties: {} } }));
      }
      if (isRoblox) robloxToolsCache = { at: Date.now(), tools };
      return tools;
    } catch (err) {
      if (isRoblox && allowRecovery) {
        // One deterministic recovery attempt: discard only this server's
        // stdio process, then repeat the documented handshake from scratch.
        await invoke("mcp_kill", { serverId: server.id }).catch(() => {});
        return mcpConnect(server, false);
      }
      if (!(isRoblox && isRobloxNoToolsError(err))) {
        await invoke("mcp_kill", { serverId: server.id }).catch(() => {});
      }
      throw err;
    }
  } else {
    const url = server.url!;
    await httpCall(url, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "Meridian", version: "1.0.0" },
    });
    await httpNotify(url, "notifications/initialized", {});
    const tools = await discoverToolsWithRetry(
      () => httpCall(url, "tools/list", {}) as Promise<{ tools?: McpTool[] }>,
      isRobloxServer(server),
    );
    if (isRobloxServer(server) && tools.length === 0) {
      throw new Error(ROBLOX_NO_TOOLS_MESSAGE);
    }
    return tools;
  }
}

export async function mcpDisconnect(server: McpServer): Promise<void> {
  if (server.transport === "stdio") {
    await invoke("mcp_kill", { serverId: server.id }).catch(() => {});
  }
}

export async function mcpCallTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const params = { name: toolName, arguments: args };
  let result: unknown;
  if (server.transport === "stdio") {
    result = await stdioCall(server.id, "tools/call", params);
  } else {
    result = await httpCall(server.url!, "tools/call", params);
  }
  const r = result as { content?: McpToolResult["content"]; isError?: boolean };
  return {
    content: r?.content ?? [{ type: "text", text: String(result) }],
    isError: r?.isError ?? false,
  };
}

export function mcpToolResultToText(result: McpToolResult): string {
  return result.content
    .map(c => c.type === "text" ? c.text : `[image: ${c.mimeType}]`)
    .join("\n");
}

export function buildMcpToolsPrompt(servers: McpServer[]): string {
  const active = servers.filter(s => s.enabled && s.status === "connected" && s.tools?.length);
  if (!active.length) return "";

  const lines: string[] = [
    "\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•",
    "MCP TOOLS - External integrations",
    "â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•",
    "CRITICAL RULES:",
    "For Roblox Studio, use the advertised mcp__roblox-studio__ tool directly whenever the user asks to inspect, create, edit, run, or test something in Studio.",
    "Never answer with standalone Luau code when a matching Roblox tool exists. Never invent tool names, arguments, paths, or results.",
    "Before mutating Studio, inspect first when possible. Use the exact JSON schema returned by tools/list; do not substitute file_path for target_file or code for the required field.",
    "For multi_edit, send file_path as a dot-notation Roblox path and edits as a real JSON array of {old_string,new_string}; for execute_luau, send datamodel_type plus code as plain Luau text with real newlines.",
    "For execute_luau, use datamodel_type=Client for LocalPlayer, PlayerGui, PlayerScripts, or character code. Use Edit only for server/edit-time APIs.",
    "For multi_edit, edits MUST be a JSON array like [{\"old_string\":\"\",\"new_string\":\"...\"}], never YAML with '- new_string:'.",
    "1. Use the EXACT parameter names from the schema below — no substitutions.",
    "2. Array parameters (e.g. edits, properties) MUST be valid JSON arrays: [{...}, {...}]",
    "3. Object parameters MUST be valid JSON objects: {\"key\": \"value\"}",
    "4. DO NOT wrap arrays/objects in quotes — they must be raw JSON, not strings.",
    "5. For Roblox Studio: multi_edit requires the script to ALREADY EXIST.",
    "   To CREATE a new script, use execute_luau with Instance.new() instead.",
    "",
    "Tool call format:",
    "[TOOL: mcp__SERVER_ID__tool_name]",
    "string_param: plain text value",
    "array_param: [{\"key\": \"value\"}, {\"key\": \"value2\"}]",
    "number_param: 42",
    "[/TOOL]",
    "",
  ];

  for (const server of active) {
    lines.push(`-- ${server.name} (id: ${server.id}) --`);

    const cfg = server.settings;
    if (cfg) {
      const hints: string[] = [];
      if (cfg.casing) hints.push(`Use ${cfg.casing} naming convention for identifiers`);
      if (cfg.includeComments) hints.push("Include descriptive comments in generated code");
      else hints.push("Do NOT include comments in generated code - keep it concise");
      if (cfg.useModuleScripts) hints.push("Prefer ModuleScript over Script/LocalScript where appropriate");
      if (cfg.maxResults) hints.push(`Limit search/list results to ${cfg.maxResults} items`);
      if (hints.length) lines.push(`Settings: ${hints.join(". ")}.`);
    } else {
      lines.push("Settings: Use camelCase naming. Do NOT include comments.");
    }
    for (const tool of server.tools ?? []) {
      lines.push(`\nTool: mcp__${server.id}__${tool.name}`);
      lines.push(`Description: ${tool.description}`);
      const schema = tool.inputSchema as {
        properties?: Record<string, { type?: string; description?: string; items?: unknown }>;
        required?: string[];
      };
      if (schema?.properties) {
        const required = new Set(schema.required ?? []);
        lines.push("Parameters:");
        for (const [paramName, paramDef] of Object.entries(schema.properties)) {
          const req = required.has(paramName) ? " (REQUIRED)" : " (optional)";
          const type = paramDef.type ?? "string";
          const desc = paramDef.description ? ` â€” ${paramDef.description}` : "";
          const isArray = type === "array";
          lines.push(`  ${paramName}${req}: ${type}${isArray ? " [pass as JSON array]" : ""}${desc}`);
        }
      }
    }
    lines.push("");
  }

  lines.push("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n");
  return lines.join("\n");
}
