
import { invoke } from "@tauri-apps/api/core";
import { decrypt, encrypt, isUnlocked } from "./skillCrypto";

export type SkillFieldType = "string" | "password" | "number" | "boolean" | "select";

export interface SkillSettingField {
	key: string;
	label: string;
	type: SkillFieldType;
	secret?: boolean;
	default?: string | number | boolean;
	description?: string;
	placeholder?: string;
	options?: string[];
}

export interface SkillSettingsSchema {
	fields: SkillSettingField[];
}

const STORAGE_KEY = "meridian.skillSettings.v1";

type RawStore = Record<string, Record<string, unknown>>;

function readStore(): RawStore {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeStore(store: RawStore): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {
	}
}

export async function loadSkillSchema(skillMdPath: string): Promise<SkillSettingsSchema | null> {
	const settingsPath = skillMdPath.replace(/[\\/]SKILL\.md$/i, (m) => m.replace(/SKILL\.md$/i, "settings.json"));
	if (settingsPath === skillMdPath) {
		console.warn(`[skillSettings] could not derive settings path from: ${skillMdPath}`);
		return null;
	}
	console.debug(`[skillSettings] trying schema at: ${settingsPath}`);

let raw = "";
	try {
		raw = await invoke<string>("tool_read_file", { path: settingsPath });
	} catch (e) {
		const msg = String(e ?? "");
		const isMissing = msg.includes("os error 2") || msg.includes("ENOENT") || msg.includes("cannot find the file");
		if (!isMissing) {
			console.warn(`[skillSettings] failed to read ${settingsPath}:`, e);
		}
		return null;
	}

	try {
		const parsed = JSON.parse(raw);
		if (!parsed || !Array.isArray(parsed.fields)) {
			console.warn(`[skillSettings] invalid schema in ${settingsPath}:`, parsed);
			return null;
		}
		const fields: SkillSettingField[] = [];
		for (const f of parsed.fields) {
			if (!f || typeof f.key !== "string" || typeof f.label !== "string") continue;
			const type: SkillFieldType =
				f.type === "password" || f.type === "number" || f.type === "boolean" || f.type === "select"
					? f.type
					: "string";
			fields.push({
				key: f.key,
				label: f.label,
				type,
				secret: !!f.secret || type === "password",
				default: f.default,
				description: typeof f.description === "string" ? f.description : undefined,
				placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
				options: Array.isArray(f.options) ? f.options.filter((o: unknown) => typeof o === "string") : undefined,
			});
		}
		return { fields };
	} catch {
		return null;
	}
}

export function getRawSkillSettings(skillName: string): Record<string, unknown> {
	const store = readStore();
	return store[skillName] ?? {};
}

export function setRawSkillSettings(skillName: string, values: Record<string, unknown>): void {
	const store = readStore();
	const trimmed: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(values)) {
		if (v === undefined || v === null || v === "") continue;
		trimmed[k] = v;
	}
	if (Object.keys(trimmed).length === 0) {
		delete store[skillName];
	} else {
		store[skillName] = trimmed;
	}
	writeStore(store);
}

export async function getDecryptedSkillSettings(
	skillName: string,
	schema: SkillSettingsSchema,
): Promise<Record<string, string | number | boolean | null>> {
	const raw = getRawSkillSettings(skillName);
	const out: Record<string, string | number | boolean | null> = {};

	for (const field of schema.fields) {
		const stored = raw[field.key];
		if (stored === undefined) {
			if (field.default !== undefined) out[field.key] = field.default;
			continue;
		}

		if (field.secret) {
			if (typeof stored !== "string") {
				out[field.key] = null;
				continue;
			}
			if (!isUnlocked()) {
				out[field.key] = null;
				continue;
			}
			try {
				out[field.key] = await decrypt(stored);
			} catch {
				out[field.key] = null;
			}
		} else if (field.type === "boolean") {
			out[field.key] = !!stored;
		} else if (field.type === "number") {
			const n = typeof stored === "number" ? stored : Number(stored);
			out[field.key] = Number.isFinite(n) ? n : (field.default as number) ?? 0;
		} else {
			out[field.key] = typeof stored === "string" ? stored : String(stored);
		}
	}

	return out;
}

export async function saveSkillSettings(
	skillName: string,
	schema: SkillSettingsSchema,
	values: Record<string, string | number | boolean | null | undefined>,
): Promise<void> {
	const raw: Record<string, unknown> = {};

	for (const field of schema.fields) {
		const v = values[field.key];
		if (v === undefined || v === null || v === "") continue;

		if (field.secret) {
			if (typeof v !== "string") continue;
			if (!isUnlocked()) {
				throw new Error("Skill vault must be unlocked to save secret fields");
			}
			raw[field.key] = await encrypt(v);
		} else if (field.type === "boolean") {
			raw[field.key] = !!v;
		} else if (field.type === "number") {
			const n = typeof v === "number" ? v : Number(v);
			if (Number.isFinite(n)) raw[field.key] = n;
		} else {
			raw[field.key] = String(v);
		}
	}

	setRawSkillSettings(skillName, raw);
}

export function wipeAllSkillSettings(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
	}
}

export function listConfiguredSkills(): string[] {
	return Object.keys(readStore());
}
