// App-wide settings stored in localStorage.
// Keep this module dependency-free so any other lib can import it.
// NOTE: This is the *agent runtime* settings (sandbox, display), not the main
// AppSettings from types/index.ts. Named AgentSettings here to avoid confusion.

export interface AgentSettings {
  // Display
  compactReadTools: boolean; // collapse noisy read-only tools in the chat

  // Safety / sandbox
  restrictToWorkingDir: boolean; // block edits outside the working directory
  confirmOutsideWorkingDir: boolean; // when not restricted, ask before touching outside paths
}

// Keep legacy export for any code still importing AppSettings from this file.
export type AppSettings = AgentSettings;

const STORAGE_KEY = "meridian.settings.v1";

const DEFAULTS: AgentSettings = {
  compactReadTools: true,
  restrictToWorkingDir: true,
  confirmOutsideWorkingDir: true,
};

let cached: AgentSettings | null = null;

export function getSettings(): AgentSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      cached = { ...DEFAULTS, ...parsed };
    } else {
      cached = { ...DEFAULTS };
    }
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached!;
}

export function updateSettings(patch: Partial<AgentSettings>): AgentSettings {
  const next = { ...getSettings(), ...patch };
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function resetSettings(): AgentSettings {
  cached = { ...DEFAULTS };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* ignore */
  }
  return cached;
}

// ---------- Tool classification helpers ----------

// Read-only / inspection tools — safe to render in compact form.
export const READ_ONLY_TOOLS = new Set<string>([
  "read-file",
  "read-file-range",
  "list-directory",
  "search-files",
  "file-exists",
  "file-info",
  "fetch-url",
]);

// Tools that mutate the filesystem. Used for the sandbox check.
export const WRITE_TOOLS = new Set<string>([
  "write-file",
  "append-file",
  "edit-file",
  "create-directory",
  "copy-file",
  "move-file",
  "delete-file",
]);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

// ---------- Path sandbox ----------

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

/**
 * Returns true if `path` is inside `workingDir`.
 * Relative paths are always considered inside.
 * Absolute paths are compared against the normalized working dir prefix.
 */
export function isPathInsideWorkingDir(
  path: string,
  workingDir: string
): boolean {
  if (!path) return true;
  const isAbsolute =
    /^([a-zA-Z]:[\\/])/.test(path) || path.startsWith("/") || path.startsWith("\\");
  if (!isAbsolute) return true;
  if (!workingDir || workingDir === "(unknown)") return true;

  const np = normalize(path);
  const nw = normalize(workingDir);
  return np === nw || np.startsWith(nw + "/");
}

/**
 * Returns the list of path-like values found in a tool input, for sandbox checks.
 */
export function extractToolPaths(input: any): string[] {
  if (!input || typeof input !== "object") return [];
  const out: string[] = [];
  for (const key of ["path", "source", "destination"]) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  return out;
}
