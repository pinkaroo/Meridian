import {
	X,
	Zap,
	Wrench,
	FileEdit,
	Terminal,
	Circle,
	MessageSquare,
	Check,
} from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ActivityEvent, AgentStatus } from "../types";

interface Props {
	activity: ActivityEvent[];
	status: AgentStatus;
	onClose: () => void;
}

type IconType = ComponentType<{ className?: string }>;

const EVENT_ICONS: Record<ActivityEvent["type"], IconType> = {
	tool_use: Wrench,
	file_modified: FileEdit,
	command_exec: Terminal,
	status_change: Circle,
	message: MessageSquare,
	approval: Check,
	thinking: Zap,
};

const EVENT_COLORS: Record<ActivityEvent["type"], string> = {
	tool_use: "text-indigo-400",
	file_modified: "text-violet-400",
	command_exec: "text-emerald-400",
	status_change: "text-muted-foreground",
	message: "text-blue-400",
	approval: "text-amber-400",
	thinking: "text-amber-400",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
	idle: "Idle",
	working: "Working",
	queued: "Queued",
	waiting_approval: "Waiting Approval",
	paused: "Paused",
	completed: "Completed",
	failed: "Failed",
	interrupted: "Interrupted",
};

const STATUS_BADGE: Record<AgentStatus, string> = {
	idle: "bg-muted text-muted-foreground border-border",
	working: "bg-sky-500/10 text-sky-500 border-sky-500/30",
	queued: "bg-blue-500/10 text-blue-500 border-blue-500/30",
	waiting_approval: "bg-amber-500/10 text-amber-500 border-amber-500/30",
	paused: "bg-muted text-muted-foreground border-border",
	completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
	failed: "bg-destructive/10 text-destructive border-destructive/30",
	interrupted: "bg-amber-500/10 text-amber-500 border-amber-500/30",
};

function formatTime(ts: number) {
	return new Date(ts).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export default function AgentActivityPanel({ activity, status, onClose }: Props) {
	return (
		<div className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<div className="flex items-center gap-2">
					<Zap className="h-4 w-4 text-primary" />
					<span className="text-sm font-semibold">Agent Activity</span>
				</div>
				<div className="flex items-center gap-1.5">
					<Badge variant="outline" className={cn("h-5 px-1.5 text-[0.65rem] font-semibold", STATUS_BADGE[status])}>
						{STATUS_LABELS[status]}
					</Badge>
					<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
						<X className="h-4 w-4" />
					</Button>
				</div>
			</div>

			<ScrollArea className="flex-1">
				{activity.length === 0 ? (
					<div className="py-12 text-center text-sm text-muted-foreground">No activity yet</div>
				) : (
					<div className="flex flex-col">
						{[...activity].reverse().map((ev) => {
							const Icon = EVENT_ICONS[ev.type];
							return (
								<div
									key={ev.id}
									className="flex items-start gap-2 border-b border-border px-4 py-2"
								>
									<Icon className={cn("mt-0.5 h-4 w-4 shrink-0", EVENT_COLORS[ev.type])} />
									<div className="min-w-0 flex-1">
										<div className="text-xs font-medium leading-snug">{ev.label}</div>
										{ev.detail && (
											<div className="line-clamp-2 text-[0.7rem] leading-snug text-muted-foreground">
												{ev.detail}
											</div>
										)}
									</div>
									<span className="mt-0.5 shrink-0 text-[0.65rem] text-muted-foreground">
										{formatTime(ev.timestamp)}
									</span>
								</div>
							);
						})}
					</div>
				)}
			</ScrollArea>
		</div>
	);
}
