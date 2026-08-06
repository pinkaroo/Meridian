import { useState, useEffect, useMemo, useRef } from "react";
import type { Message } from "../types";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";

interface Props {
	messages: Message[];
	onJump: (msgId: string, matchIndex: number) => void;
	onClose: () => void;
}

interface Match {
	msgId: string;
	msgIdx: number;
	offset: number;
}

export default function InConvSearch({ messages, onJump, onClose }: Props) {
	const [query, setQuery] = useState("");
	const [activeIdx, setActiveIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const matches = useMemo<Match[]>(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 1) return [];
		const out: Match[] = [];
		messages.forEach((m, mi) => {
			if (!m.content) return;
			const lower = m.content.toLowerCase();
			let start = 0;
			while (start < lower.length) {
				const i = lower.indexOf(q, start);
				if (i < 0) break;
				out.push({ msgId: m.id, msgIdx: mi, offset: i });
				start = i + q.length;
				if (out.length >= 500) return;
			}
		});
		return out;
	}, [query, messages]);

	useEffect(() => { setActiveIdx(0); }, [query]);

	useEffect(() => {
		const m = matches[activeIdx];
		if (m) onJump(m.msgId, activeIdx);
	}, [activeIdx, matches, onJump]);

	function go(delta: number) {
		if (matches.length === 0) return;
		setActiveIdx(i => (i + delta + matches.length) % matches.length);
	}

	function handleKey(e: React.KeyboardEvent) {
		if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
		if (e.key === "Enter") {
			e.preventDefault();
			go(e.shiftKey ? -1 : 1);
		}
	}

	return (
		<div className="absolute right-4 top-3 z-20 flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 shadow-lg">
			<Search className="h-3.5 w-3.5 text-muted-foreground" />
			<input
				ref={inputRef}
				value={query}
				onChange={e => setQuery(e.target.value)}
				onKeyDown={handleKey}
				placeholder="Find in conversation"
				className="w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
			/>
			<span className="min-w-[3rem] text-right text-[0.65rem] text-muted-foreground">
				{matches.length === 0 ? (query ? "0/0" : "") : `${activeIdx + 1}/${matches.length}`}
			</span>
			<button
				type="button"
				onClick={() => go(-1)}
				disabled={matches.length === 0}
				className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
				title="Previous (Shift+Enter)"
			>
				<ChevronUp className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onClick={() => go(1)}
				disabled={matches.length === 0}
				className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
				title="Next (Enter)"
			>
				<ChevronDown className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onClick={onClose}
				className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				title="Close (Esc)"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
