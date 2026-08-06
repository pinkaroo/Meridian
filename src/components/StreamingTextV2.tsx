import { useState, useRef, useEffect, useMemo } from "react";
import MarkdownRenderer from "./MarkdownRenderer";

export default function StreamingTextV2({ text, live }: { text: string; live: boolean }) {
	const [displayed, setDisplayed] = useState(live ? "" : text);
	const targetRef = useRef(text);
	const displayedRef = useRef(live ? "" : text);
	const lastFlushRef = useRef(0);
	const rafRef = useRef<number | null>(null);
	const lastTickRef = useRef<number>(0);

	targetRef.current = text;

	useEffect(() => {
		if (!live) {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			displayedRef.current = text;
			setDisplayed(text);
			return;
		}

		const STOP_CHARS = " \n\t.,;!?)]}>\"'`-";
		const FLUSH_INTERVAL_MS = 33;

		const tick = (now: number) => {
			const last = lastTickRef.current || now;
			const dt = Math.min(64, Math.max(0, now - last));
			lastTickRef.current = now;

			const target = targetRef.current;
			const current = displayedRef.current;
			const behind = target.length - current.length;

			if (behind <= 0) {
				rafRef.current = requestAnimationFrame(tick);
				return;
			}

			const baseCps = 110;
			const catchupCps = behind * 6;
			const cps = Math.min(2400, Math.max(baseCps, catchupCps));
			let take = Math.max(1, Math.round((cps * dt) / 1000));
			take = Math.min(take, behind);
			let nextLen = current.length + take;

			if (nextLen < target.length && behind < 200) {
				const cap = Math.min(target.length, nextLen + 20);
				while (nextLen < cap && !STOP_CHARS.includes(target[nextLen])) {
					nextLen += 1;
				}
			}

			const next = target.slice(0, nextLen);
			displayedRef.current = next;

			if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) {
				lastFlushRef.current = now;
				setDisplayed(next);
			}
			rafRef.current = requestAnimationFrame(tick);
		};

		lastTickRef.current = 0;
		lastFlushRef.current = 0;
		rafRef.current = requestAnimationFrame(tick);
		return () => {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			if (displayedRef.current !== "" && live) {
				setDisplayed(displayedRef.current);
			}
		};
	}, [live]);

	const safeText = useMemo(() => {
		const cleaned = displayed
			.replace(/\[WAIT-FOR-RESULTS\][\s\S]*?\[\/WAIT-FOR-RESULTS\]/gi, "")
			.replace(/\[WAIT-FOR-RESULTS\]|\[\/WAIT-FOR-RESULTS\]/gi, "");
		if (!live) return cleaned;
		// Count unclosed code fences. If we have an odd count, append a synthetic
		// closing fence so markdown still renders the partial block as code
		// instead of either (a) flickering between prose/code as the stream
		// progresses or (b) stripping the orphan opener and rendering the
		// in-progress code as prose for one frame.
		let count = 0;
		let idx = cleaned.indexOf("```");
		while (idx !== -1) {
			count += 1;
			idx = cleaned.indexOf("```", idx + 3);
		}
		if (count % 2 === 1) {
			return cleaned + (cleaned.endsWith("\n") ? "" : "\n") + "```";
		}
		return cleaned;
	}, [displayed, live]);

	const rendered = useMemo(
		() => <MarkdownRenderer content={safeText} />,
		[safeText]
	);

	return (
		<div className="relative motion-stream typing-fade-in">
			{rendered}
		</div>
	);
}
