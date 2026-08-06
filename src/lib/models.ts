import { invoke } from "@tauri-apps/api/core";
import type { ModelOption } from "../types";

type ModelsListener = (models: ModelOption[]) => void;
export type ModelAccess = "Free" | "Paid" | "Free & Paid";
export type ModelMeta = { provider: string; access: ModelAccess; contextWindow?: number; inputCostUsdPerMillion?: number; outputCostUsdPerMillion?: number };

const listeners = new Set<ModelsListener>();
const metadata = new Map<string, ModelMeta>();

const fallback = [
	{ id: "browser:deepseek", name: "DeepSeek (Browser)", tag: "standard" as const, provider: "browser", access: "Free" as const },
	{ id: "browser:gemini", name: "Gemini (Browser)", tag: "fast" as const, provider: "browser", access: "Free" as const },
	{ id: "browser:kimi", name: "Kimi (Browser)", tag: "standard" as const, provider: "browser", access: "Free" as const },
	{ id: "browser:glm", name: "GLM (Browser)", tag: "standard" as const, provider: "browser", access: "Free" as const },
	{ id: "browser:qwen", name: "Qwen (Browser)", tag: "standard" as const, provider: "browser", access: "Free" as const },
	{ id: "browser:arena", name: "Arena (Browser)", tag: "standard" as const, provider: "browser", access: "Free" as const },
	{ id: "google:gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", tag: "fast" as const, provider: "google", access: "Free" as const },
	{ id: "deepseek:deepseek-chat", name: "DeepSeek V3", tag: "standard" as const, provider: "deepseek", access: "Paid" as const },
	{ id: "deepseek:deepseek-reasoner", name: "DeepSeek R1", tag: "reasoning" as const, provider: "deepseek", access: "Paid" as const },
	{ id: "openrouter:openai/gpt-4o-mini:free", name: "GPT-4o Mini", tag: "fast" as const, provider: "openrouter", access: "Free" as const },
	{ id: "openrouter:meta-llama/llama-3.3-8b-instruct:free", name: "Llama 3.3 8B", tag: "standard" as const, provider: "openrouter", access: "Free" as const },
];

export let MODELS: ModelOption[] = fallback.map(({ provider, access, ...model }) => {
	metadata.set(model.id, { provider, access });
	return model;
});

export const isBrowserModel = (id: string) => id.startsWith("browser:");
const browserModels = fallback.filter(model => model.provider === "browser").map(({ provider: _provider, access: _access, ...model }) => model);

export function subscribeToModels(listener: ModelsListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function notify() {
	for (const listener of listeners) listener(MODELS);
}

function tagFromSlug(value: string): ModelOption["tag"] {
	const normalized = value.toLowerCase();
	if (/(reason|r1|o3|thinking)/.test(normalized)) return "reasoning";
	if (/(mini|nano|flash|lite|small)/.test(normalized)) return "fast";
	if (/(opus|pro|max|gpt-5|sonnet)/.test(normalized)) return "flagship";
	return "standard";
}

export async function fetchDynamicModels() {
	try {
		const catalog = await invoke<Array<{ id: string; name: string; provider: string; access: ModelAccess; tag: ModelOption["tag"]; contextWindow?: number; inputCostUsdPerMillion?: number; outputCostUsdPerMillion?: number }>>("provider_models");
		if (!catalog.length) return;
		metadata.clear();
		MODELS = [...browserModels, ...catalog.map((model) => {
			metadata.set(model.id, { provider: model.provider, access: model.access, contextWindow: model.contextWindow, inputCostUsdPerMillion: model.inputCostUsdPerMillion, outputCostUsdPerMillion: model.outputCostUsdPerMillion });
			return { id: model.id, name: model.name, tag: model.tag || tagFromSlug(model.id) };
		})];
		notify();
	} catch {
		metadata.clear();
		MODELS = fallback.map(({ provider, access, ...model }) => {
			metadata.set(model.id, { provider, access });
			return model;
		});
		notify();
	}
}

export function getModel(id: string): ModelOption {
	return MODELS.find((model) => model.id === id) ?? MODELS[0];
}

export function getModelMeta(id: string): ModelMeta {
	return metadata.get(id) ?? { provider: "openrouter", access: "Free & Paid" };
}

export const TAG_COLORS: Record<string, string> = {
	flagship: "#f4b75a",
	standard: "#8a7dff",
	fast: "#4ed3a4",
	reasoning: "#c388ff",
};
