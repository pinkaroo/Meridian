import { useState, useEffect, useMemo, useRef } from "react";
import type { Conversation } from "../types";
import { Search, X, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface Hit {
	convId: string;
	convTitle: string;
	msgId: string;
	role: string;
	excerpt: string;
	matchStart: number;
	matchEnd: number;
	timestamp: number;
}

interface Props {
	conversations: Conversation[];
	onJump: (convId: string, msgId: string) => void;
	onClose: () => void;
}

const MAX_HITS = 200;
const EXCERPT_RADIUS = 60;

export default function GlobalSearch({ conversations, onJump, onClose }: Props) {
	const [query, setQuery] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const hits = useMemo<Hit[]>(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2) return [];
		const out: Hit[] = [];
		const live = conversations.filter(c => !c.deleted);

		for (const conv of live) {
			const titleIdx = conv.title.toLowerCase().indexOf(q);
			if (titleIdx >= 0) {
				out.push({
					convId: conv.id,
					convTitle: conv.title,
					msgId: conv.messages[0]?.id ?? "",
					role: "title",
					excerpt: conv.title,
					matchStart: titleIdx,
					matchEnd: titleIdx + q.length,
					timestamp: conv.updatedAt,
				});
				if (out.length >= MAX_HITS) break;
			}

			for (const msg of conv.messages) {
				if (!msg.content) continue;
				const lower = msg.content.toLowerCase();
				const idx = lower.indexOf(q);
				if (idx < 0) continue;
				const start = Math.max(0, idx - EXCERPT_RADIUS);
				const end = Math.min(msg.content.length, idx + q.length + EXCERPT_RADIUS);
				const prefix = start > 0 ? "..." : "";
				const suffix = end < msg.content.length ? "..." : "";
				const excerpt = prefix + msg.content.slice(start, end) + suffix;
				out.push({
					convId: conv.id,
					convTitle: conv.title,
					msgId: msg.id,
					role: msg.role,
					excerpt,
					matchStart: prefix.length + (idx - start),
					matchEnd: prefix.length + (idx - start) + q.length,
					timestamp: msg.timestamp,
				});
				if (out.length >= MAX_HITS) break;
			}
			if (out.length >= MAX_HITS) break;
		}

		out.sort((a, b) => b.timestamp - a.timestamp);
		return out;
	}, [query, conversations]);

	useEffect(() => { setSelectedIdx(0); }, [query]);

	useEffect(() => {
		const el = listRef.current?.querySelector<HTMLElement>(`[data-hit-idx="${selectedIdx}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [selectedIdx]);

	function handleKey(e: React.KeyboardEvent) {
		if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
		if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(hits.length - 1, i + 1)); return; }
		if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)); return; }
		if (e.key === "Enter") {
			e.preventDefault();
			const hit = hits[selectedIdx];
			if (hit) { onJump(hit.convId, hit.msgId); onClose(); }
		}
	}

	function renderExcerpt(hit: Hit) {
		const before = hit.excerpt.slice(0, hit.matchStart);
		const match = hit.excerpt.slice(hit.matchStart, hit.matchEnd);
		const after = hit.excerpt.slice(hit.matchEnd);
		return (
			<>
				<span className="text-muted-foreground">{before}</span>
				<mark className="rounded bg-amber-500/30 px-0.5 text-foreground">{match}</mark>
				<span className="text-muted-foreground">{after}</span>
			</>
		);
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]"
			onClick={onClose}
		>
			<div
				className="flex w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
				onClick={e => e.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b border-border px-3 py-2">
					<Search className="h-4 w-4 text-muted-foreground" />
					<input
						ref={inputRef}
						value={query}
						onChange={e => setQuery(e.target.value)}
						onKeyDown={handleKey}
						placeholder="Search across all conversations..."
						className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
					<span className="text-[0.65rem] text-muted-foreground">
						{query.trim().length < 2 ? "Type 2+ chars" : `${hits.length}${hits.length >= MAX_HITS ? "+" : ""} hits`}
					</span>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				<div ref={listRef} className="max-h-[60vh] overflow-y-auto">
					{hits.length === 0 && query.trim().length >= 2 && (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">
							No matches in any conversation.
						</div>
					)}
					{hits.length === 0 && query.trim().length < 2 && (
						<div className="px-4 py-8 text-center text-xs text-muted-foreground">
							Search titles and message contents across every conversation.
							<div className="mt-2 flex justify-center gap-3 text-[0.65rem]">
								<span><kbd className="rounded border border-border px-1.5 py-0.5 font-mono">Ã¢Â†Â‘Ã¢Â†Â“</kbd> navigate</span>
								<span><kbd className="rounded border border-border px-1.5 py-0.5 font-mono">Ã¢Â†Âµ</kbd> jump</span>
								<span><kbd className="rounded border border-border px-1.5 py-0.5 font-mono">Esc</kbd> close</span>
							</div>
						</div>
					)}
					{hits.map((hit, idx) => (
						<button
							key={`${hit.convId}-${hit.msgId}-${idx}`}
							data-hit-idx={idx}
							type="button"
							onClick={() => { onJump(hit.convId, hit.msgId); onClose(); }}
							onMouseEnter={() => setSelectedIdx(idx)}
							className={cn(
								"flex w-full flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left text-xs transition-colors",
								selectedIdx === idx ? "bg-accent" : "hover:bg-accent/50",
							)}
						>
							<div className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
								<MessageSquare className="h-3 w-3" />
								<span className="truncate font-semibold">{hit.convTitle}</span>
								<span>Ã‚Â·</span>
								<span>{hit.role}</span>
							</div>
							<div className="line-clamp-2 text-xs leading-snug">
								{renderExcerpt(hit)}
							</div>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
