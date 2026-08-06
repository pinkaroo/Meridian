import { useState, useEffect } from "react";

const MESSAGES = [
	"Loading conversations",
	"Restoring your workspace",
	"Preparing the agent",
	"Almost there",
];

export default function LoadingScreen({ onDone }: { onDone: () => void }) {
	const [msgIdx, setMsgIdx] = useState(0);
	const [fade, setFade] = useState(true);
	const [leaving, setLeaving] = useState(false);

	useEffect(() => {
		const interval = setInterval(() => {
			setFade(false);
			setTimeout(() => {
				setMsgIdx(prev => (prev + 1) % MESSAGES.length);
				setFade(true);
			}, 300);
		}, 1400);
		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => {
			setLeaving(true);
			setTimeout(onDone, 600);
		}, 2200);
		return () => clearTimeout(timer);
	}, [onDone]);

	return (
		<div
			className="fixed inset-0 z-[9999] flex items-center justify-center bg-background transition-opacity duration-500"
			style={{ opacity: leaving ? 0 : 1, pointerEvents: leaving ? "none" : "auto" }}
		>
			<div className="flex flex-col items-center gap-4">
				<div className="text-foreground">
					<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
						<circle cx="12" cy="12" r="10" />
						<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
				</div>
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">Meridian</h1>
				<div className="flex gap-1">
					<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
					<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
					<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
				</div>
				<p
					className="text-sm text-muted-foreground min-h-5 transition-opacity duration-300"
					style={{ opacity: fade ? 1 : 0 }}
				>
					{MESSAGES[msgIdx]}
				</p>
			</div>
		</div>
	);
}