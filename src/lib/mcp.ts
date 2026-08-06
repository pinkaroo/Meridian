
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
  "Meridian started the Roblox MCP bridge, but Roblox Studio has not attached to it yet. Leave Meridian open, then in Roblox Studio open Assistant, click the three-dot menu, choose Manage MCP Servers, and turn Enable Studio as MCP server off and on. Then click Connect again.";

function isRobloxServer(server: McpServer): boolean {
  return server.id.startsWith("roblox-studio");
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
  const attempts = shouldRetryEmpty ? 4 : 1;
  let tools: McpTool[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await call();
    tools = result?.tools ?? [];
    if (tools.length > 0 || attempt === attempts - 1) break;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  return tools;
}


export const MCP_PRESETS = [
  {
    id: "roblox-studio",
    name: "Roblox Studio",
    description: "Control Roblox Studio â€” read/write scripts, manage instances, run commands in Studio",
    icon: "ðŸŽ®",
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
    description: "Control a browser â€” navigate, screenshot, interact with web pages",
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
  return invoke<unknown>("mcp_call", {
    serverId,
    method,
    params: params ?? {},
  });
}

async function stdioNotify(serverId: string, method: string, params?: unknown): Promise<void> {
  await invoke("mcp_notify", {
    serverId,
    method,
    params: params ?? {},
  });
}


export async function mcpConnect(server: McpServer): Promise<McpTool[]> {
  if (server.transport === "stdio") {
    const isRoblox = isRobloxServer(server);
    try {
      let processState = isRoblox
        ? await getMcpProcessState(server.id)
        : { running: false, initialized: false };

      if (!isRoblox || !processState.running) {
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
        throw new Error(ROBLOX_NO_TOOLS_MESSAGE);
      }
      return tools;
    } catch (err) {
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
      server.id.startsWith("roblox-studio"),
    );
    if (server.id.startsWith("roblox-studio") && tools.length === 0) {
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
    "MCP TOOLS â€” External integrations",
    "â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•",
    "CRITICAL RULES:",
    "1. Use the EXACT parameter names from the schema below â€” no substitutions.",
    "2. Array parameters (e.g. edits, properties) MUST be valid JSON arrays: [{...}, {...}]",
    "3. Object parameters MUST be valid JSON objects: {\"key\": \"value\"}",
    "4. DO NOT wrap arrays/objects in quotes â€” they must be raw JSON, not strings.",
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
    lines.push(`â”€â”€ ${server.name} (id: ${server.id}) â”€â”€`);

    const cfg = server.settings;
    if (cfg) {
      const hints: string[] = [];
      if (cfg.casing) hints.push(`Use ${cfg.casing} naming convention for identifiers`);
      if (cfg.includeComments) hints.push("Include descriptive comments in generated code");
      else hints.push("Do NOT include comments in generated code â€” keep it concise");
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
