import { useState, useEffect } from "react";
import { Lightbulb, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "./MarkdownRenderer";

interface ThinkingBlockProps {
	text: string;
	streaming: boolean;
}

export default function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
	const [collapsed, setCollapsed] = useState(true);
	const liveLabel = text.trim().split(/\n+/).find(Boolean)?.trim() || "Planning the next step";


	return (
		<div className="thinking-row my-1 overflow-hidden">
			<button type="button" onClick={() => setCollapsed(value => !value)} className="no-press flex w-full items-center gap-2 px-1 py-1.5 text-left transition-colors hover:bg-accent/20">
				<Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className={cn("flex-1 truncate text-sm font-medium", streaming ? "shimmer-text" : "text-foreground")}>{streaming ? `Running: ${liveLabel}` : text.trim() ? "Thought process" : "You stopped this response"}</span>
				<ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-150", collapsed ? "rotate-0" : "rotate-180")} />
			</button>
			<div className={cn("grid transition-all duration-200", collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]")}>
				<div className="overflow-hidden">
					<div className="border-t border-border/40 px-1 py-2">
						<div className="text-xs leading-relaxed text-muted-foreground [&_code]:font-mono [&_code]:text-primary [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/50 [&_pre]:p-2">
							<MarkdownRenderer content={text || "_Planning..._"} />
							{streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-foreground/70 align-middle" />}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
