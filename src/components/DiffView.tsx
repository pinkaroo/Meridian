import { memo, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type DiffOp =
	| { kind: "ctx"; line: string; aLine: number; bLine: number }
	| { kind: "add"; line: string; bLine: number }
	| { kind: "del"; line: string; aLine: number };

// Standard LCS-based line diff. O(n*m) memory â fine for typical edit payloads.
function diffLines(a: string[], b: string[]): DiffOp[] {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
			else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const ops: DiffOp[] = [];
	let i = 0, j = 0;
	let aLine = 1, bLine = 1;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			ops.push({ kind: "ctx", line: a[i], aLine, bLine });
			i++; j++; aLine++; bLine++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ kind: "del", line: a[i], aLine });
			i++; aLine++;
		} else {
			ops.push({ kind: "add", line: b[j], bLine });
			j++; bLine++;
		}
	}
	while (i < n) { ops.push({ kind: "del", line: a[i], aLine }); i++; aLine++; }
	while (j < m) { ops.push({ kind: "add", line: b[j], bLine }); j++; bLine++; }
	return ops;
}

// Compress long context runs into 3-line windows around each change.
function collapseContext(ops: DiffOp[], windowSize = 3): (DiffOp | { kind: "gap"; count: number })[] {
	const keep = new Array(ops.length).fill(false);
	for (let i = 0; i < ops.length; i++) {
		if (ops[i].kind !== "ctx") {
			for (let k = Math.max(0, i - windowSize); k <= Math.min(ops.length - 1, i + windowSize); k++) {
				keep[k] = true;
			}
		}
	}
	const out: (DiffOp | { kind: "gap"; count: number })[] = [];
	let gap = 0;
	for (let i = 0; i < ops.length; i++) {
		if (keep[i]) {
			if (gap > 0) { out.push({ kind: "gap", count: gap }); gap = 0; }
			out.push(ops[i]);
		} else {
			gap++;
		}
	}
	if (gap > 0) out.push({ kind: "gap", count: gap });
	return out;
}

function DiffViewImpl({ before, after, mode }: { before: string; after: string; mode?: "edit" | "write" | "append" }) {
	const [showAll, setShowAll] = useState(false);

	const { rendered, addCount, delCount, truncated } = useMemo(() => {
		const aLines = before === "" ? [] : before.split("\n");
		const bLines = after === "" ? [] : after.split("\n");
		const ops = diffLines(aLines, bLines);
		const collapsed = mode === "write" || showAll ? ops : collapseContext(ops);
		const addCount = ops.filter(o => o.kind === "add").length;
		const delCount = ops.filter(o => o.kind === "del").length;

		const HARD_CAP = 500;
		const truncated = !showAll && collapsed.length > HARD_CAP;
		const rendered = truncated ? collapsed.slice(0, HARD_CAP) : collapsed;
		return { rendered, addCount, delCount, truncated };
	}, [before, after, mode, showAll]);

	return (
		<div className="overflow-hidden rounded border border-border bg-muted/30 font-mono text-xs">
			<div className="flex items-center justify-between border-b border-border bg-muted/50 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
				<span>Diff</span>
				<span className="flex items-center gap-2 tabular-nums normal-case">
					<span className="text-emerald-500">+{addCount}</span>
					<span className="text-destructive">-{delCount}</span>
				</span>
			</div>
			<div className="max-h-96 overflow-auto">
				{rendered.map((op, idx) => {
					if (op.kind === "gap") {
						return (
							<div key={idx} className="border-y border-border/50 bg-muted/20 px-2 py-0.5 text-center text-[0.65rem] text-muted-foreground">
								@ {op.count} unchanged line{op.count === 1 ? "" : "s"} @
							</div>
						);
					}
					const gutter = op.kind === "ctx"
						? `${op.aLine}`
						: op.kind === "del"
							? `-${op.aLine}`
							: `+${op.bLine}`;
					return (
						<div
							key={idx}
							className={cn(
								"flex whitespace-pre",
								op.kind === "add" && "bg-emerald-500/10",
								op.kind === "del" && "bg-destructive/10",
							)}
						>
							<span className="w-12 shrink-0 select-none border-r border-border/40 px-1.5 text-right text-muted-foreground tabular-nums">
								{gutter}
							</span>
							<span className={cn(
								"w-4 shrink-0 select-none px-1 text-center",
								op.kind === "add" && "text-emerald-500",
								op.kind === "del" && "text-destructive",
							)}>
								{op.kind === "add" ? "+" : op.kind === "del" ? "-" : " "}
							</span>
							<span className="min-w-0 flex-1 px-2 py-0.5 break-all">{op.line || " "}</span>
						</div>
					);
				})}
				{truncated && (
					<button
						type="button"
						onClick={() => setShowAll(true)}
						className="w-full border-t border-border bg-muted/50 px-2 py-1 text-center text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted"
					>
						Show all (diff truncated at 500 lines)
					</button>
				)}
			</div>
		</div>
	);
}

export const DiffView = memo(DiffViewImpl);