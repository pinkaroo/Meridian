import { invoke } from "@tauri-apps/api/core";

export interface SkillEntry {
	name: string;
	description: string;
	relPath: string;
}

interface CacheEntry {
	rootsKey: string;
	skills: SkillEntry[];
	loadedAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Resolve the ordered list of skill root directories for a given workdir.
 * Workdir-local wins over the global fallback; later roots only contribute
 * skills whose name has not already been registered.
 */
export function resolveSkillRoots(workdir: string | undefined, globalRoot?: string): string[] {
	const roots: string[] = [];
	const wd = (workdir || "").trim();
	if (wd) roots.push(joinPath(wd, "skills"));
	const gr = (globalRoot || "").trim();
	if (gr && !roots.includes(gr)) roots.push(gr);
	return roots;
}

export async function loadSkills(roots: string[], opts?: { force?: boolean }): Promise<SkillEntry[]> {
	const rootsKey = roots.join("|");
	const now = Date.now();
	if (!opts?.force && cache && cache.rootsKey === rootsKey && now - cache.loadedAt < CACHE_TTL_MS) {
		return cache.skills;
	}

	const seen = new Map<string, SkillEntry>();

	for (const root of roots) {
		let dirListing = "";
		try {
			dirListing = await invoke<string>("tool_list_directory", { path: root });
		} catch {
			continue;
		}

		const skillDirs = parseSkillDirs(dirListing);

		for (const dirName of skillDirs) {
			if (seen.has(dirName)) continue;
			const skillMdPath = joinPath(root, dirName, "SKILL.md");
			let head = "";
			try {
				head = await invoke<string>("tool_read_file_range", {
					path: skillMdPath,
					start: 1,
					end: 40,
				});
			} catch {
				continue;
			}

			const stripped = stripLineNumbers(head);
			const meta = parseFrontmatter(stripped);
			if (!meta) continue;
			const name = (meta.name || dirName).trim();
			const description = (meta.description || "").trim();
			if (!description) continue;
			if (/replace with description/i.test(description)) continue;

			seen.set(name, {
				name,
				description,
				relPath: skillMdPath,
			});
		}
	}

	const skills = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
	cache = { rootsKey, skills, loadedAt: now };
	return skills;
}

export function invalidateSkillsCache(): void {
	cache = null;
}

/**
 * Render the AVAILABLE SKILLS section for injection into the system prompt.
 * Descriptions are truncated for progressive disclosure — the agent reads the
 * full SKILL.md when activating one.
 */
export function renderSkillsSection(
	skills: SkillEntry[],
	opts?: { maxDescChars?: number; configuredKeys?: Record<string, string[]> },
): string {
	if (!skills.length) return "";
	const maxDesc = opts?.maxDescChars ?? 220;
	const configured = opts?.configuredKeys ?? {};
	const lines = skills.map(s => {
		const desc = s.description.length > maxDesc
			? s.description.slice(0, maxDesc).trimEnd() + "…": s.description;
		const keys = configured[s.name];
		const cfgNote = keys && keys.length ? ` [user-configured: ${keys.join(", ")}]` : "";
		return `- **${s.name}** (${s.relPath}): ${desc}${cfgNote}`;
	});
	return `AVAILABLE SKILLS
You have ${skills.length} installed skill(s). Each skill is a structured workflow with full instructions in its SKILL.md file. The list below shows only the name and a short description — the discovery layer.

When a task matches a skill's description (even loosely), ACTIVATE the skill by reading its SKILL.md with read-file, then follow the instructions inside. Skills may reference bundled scripts, templates, or reference docs in the same directory — load those on demand. Do not paraphrase or guess a skill's contents from the description; the description is a pointer, not the instructions.

${lines.join("\n")}`;
}

function parseSkillDirs(listing: string): string[] {
	const out: string[] = [];
	for (const rawLine of listing.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (!line.endsWith("/") && !line.endsWith("\\")) continue;
		const name = line.replace(/[\/\\]+$/, "");
		if (!name || name.startsWith(".")) continue;
		out.push(name);
	}
	return out;
}

function stripLineNumbers(text: string): string {
	// tool_read_file_range returns lines prefixed with "N: " — strip them.
	return text
		.split(/\r?\n/)
		.map(line => line.replace(/^\s*\d+:\s?/, ""))
		.join("\n");
}

interface Frontmatter {
	name?: string;
	description?: string;
}

function parseFrontmatter(text: string): Frontmatter | null {
	const lines = text.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return null;
	const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
	if (endIdx === -1) return null;
	const body = lines.slice(1, endIdx);

	const out: Frontmatter = {};
	for (const raw of body) {
		const m = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
		if (!m) continue;
		const key = m[1].toLowerCase();
		let value = m[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key === "name") out.name = value;
		else if (key === "description") out.description = value;
	}
	return out;
}

function joinPath(...parts: string[]): string {
	const cleaned = parts
		.map((p, i) => {
			if (i === 0) return p.replace(/[\/\\]+$/, "");
			return p.replace(/^[\/\\]+/, "").replace(/[\/\\]+$/, "");
		})
		.filter(Boolean);
	const usesBackslash = /\\/.test(parts[0] ?? "") && !/\//.test(parts[0] ?? "");
	const sep = usesBackslash ? "\\" : "/";
	return cleaned.join(sep);
}