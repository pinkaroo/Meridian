import { useEffect, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MODELS, TAG_COLORS, fetchDynamicModels, getModel, getModelMeta, subscribeToModels } from "../lib/models";
import type { ModelOption, ModelTag } from "../types";

const TAG_LABELS: Record<ModelTag, string> = { flagship: "FLAGSHIP", standard: "STANDARD", fast: "FAST", reasoning: "REASONING" };

interface ModelPickerProps {
	value: string;
	onChange: (id: string) => void;
}

export default function ModelPicker({ value, onChange }: ModelPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [models, setModels] = useState<ModelOption[]>(() => MODELS);
	const current = getModel(value);
	const filtered = search ? models.filter((model) => model.name.toLowerCase().includes(search.toLowerCase())) : models;

	useEffect(() => {
		const unsubscribe = subscribeToModels(setModels);
		// Warm the provider catalog while the app is idle so opening the picker
		// never shows the small built-in list before remote models arrive.
		void fetchDynamicModels();
		return unsubscribe;
	}, []);

	function handleOpenChange(next: boolean) {
		setOpen(next);
		// The catalog is prefetched on mount; opening is now instant.
		if (!next) setSearch("");
	}

	function handlePick(id: string) {
		onChange(id);
		handleOpenChange(false);
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange} modal>
			<PopoverTrigger asChild>
						<Button variant="outline" size="sm" className="h-8 max-w-[240px] gap-1.5 px-2.5 font-normal">
					<span className="h-2 w-2 rounded-full" style={{ backgroundColor: TAG_COLORS[current.tag] }} />
									<span className="min-w-0 truncate text-sm font-medium">{current.name}</span>
									<span className="shrink-0 whitespace-nowrap text-[0.6rem] font-bold tracking-wide" style={{ color: TAG_COLORS[current.tag] }}>{TAG_LABELS[current.tag]}</span>
					<ChevronDown className="ml-0.5 h-3.5 w-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="z-[100] w-[min(420px,calc(100vw-2rem))] p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
				<div className="border-b border-border p-2">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input autoFocus placeholder="Search models..." value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.stopPropagation()} className="h-8 pl-7 text-sm" />
					</div>
				</div>
				{filtered.length === 0 ? <div className="py-6 text-center text-sm text-muted-foreground">No models found</div> : <ScrollArea className="h-[360px]"><div className="p-1">{filtered.map((model) => { const meta = getModelMeta(model.id); const contextWindow = typeof meta.contextWindow === "number" && Number.isFinite(meta.contextWindow) ? meta.contextWindow : undefined; const inputCost = typeof meta.inputCostUsdPerMillion === "number" && Number.isFinite(meta.inputCostUsdPerMillion) ? meta.inputCostUsdPerMillion : undefined; const outputCost = typeof meta.outputCostUsdPerMillion === "number" && Number.isFinite(meta.outputCostUsdPerMillion) ? meta.outputCostUsdPerMillion : undefined; const context = contextWindow ? `${(contextWindow / 1000).toFixed(contextWindow >= 100000 ? 0 : 1)}k ctx` : "ctx -"; const cost = inputCost === undefined ? "pricing -" : `in $${inputCost.toFixed(2)}/M out $${(outputCost ?? 0).toFixed(2)}/M`; return <button key={model.id} type="button" onClick={() => handlePick(model.id)} className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent", model.id === value && "bg-accent")}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TAG_COLORS[model.tag] }} /><span className={cn("min-w-0 flex-1 text-sm", model.id === value ? "font-semibold" : "font-normal")}><span className="block truncate">{model.name}</span><span className="block truncate text-[0.62rem] font-normal text-muted-foreground">{context} · {cost}</span></span><span className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide" style={{ color: TAG_COLORS[model.tag], backgroundColor: `${TAG_COLORS[model.tag]}22` }}>{TAG_LABELS[model.tag]}</span></button>; })}</div></ScrollArea>}
			</PopoverContent>
		</Popover>
	);
}
