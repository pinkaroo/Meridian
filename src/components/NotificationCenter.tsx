import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
	import { Button } from "@/components/ui/button";
	import { ScrollArea } from "@/components/ui/scroll-area";
	import { cn } from "@/lib/utils";
	import {
		CheckCircle2, AlertTriangle, AlertCircle, Bookmark, FileText,
	} from "lucide-react";
	import type { ComponentType } from "react";
	import type { InAppNotification } from "../types";

	interface Props {
		notifications: InAppNotification[];
		onRead: (id: string) => void;
		onClear: () => void;
		onClose: () => void;
		onNavigate: (convId?: string) => void;
	}

	type IconType = ComponentType<{ className?: string }>;

	const NOTIF_ICONS: Record<InAppNotification["type"], IconType> = {
		agent_done: CheckCircle2,
		approval_needed: AlertTriangle,
		task_done: CheckCircle2,
		task_failed: AlertCircle,
		memory_saved: Bookmark,
		file_modified: FileText,
	};

	const NOTIF_COLORS: Record<InAppNotification["type"], string> = {
		agent_done: "text-emerald-500",
		approval_needed: "text-amber-500",
		task_done: "text-emerald-500",
		task_failed: "text-destructive",
		memory_saved: "text-primary",
		file_modified: "text-violet-500",
	};

	function formatTime(ts: number) {
		const d = Date.now() - ts;
		if (d < 60000) return "just now";
		if (d < 3600000) return Math.floor(d / 60000) + "m ago";
		return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	export default function NotificationCenter({
		notifications, onRead, onClear, onClose, onNavigate,
	}: Props) {
		return (
			<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
				<SheetContent side="right" className="w-[360px] p-0">
					<SheetHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3">
						<SheetTitle className="text-base">Notifications</SheetTitle>
						{notifications.length > 0 && (
							<Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
								Clear all
							</Button>
						)}
					</SheetHeader>

					<ScrollArea className="h-[calc(100vh-57px)]">
						{notifications.length === 0 ? (
							<div className="py-12 text-center text-sm text-muted-foreground">
								No notifications
							</div>
						) : (
							<div className="flex flex-col">
								{notifications.map((n) => {
									const Icon = NOTIF_ICONS[n.type];
									const color = NOTIF_COLORS[n.type];
									return (
										<button
											key={n.id}
											type="button"
											onClick={() => { onRead(n.id); onNavigate(n.convId); }}
											className={cn(
												"flex items-start gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent",
												!n.read && "bg-accent/50",
											)}
										>
											<Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} />
											<div className="min-w-0 flex-1">
												<div className={cn("truncate text-sm leading-snug", !n.read ? "font-semibold" : "font-normal")}>
													{n.title}
												</div>
												<div className="line-clamp-2 text-xs leading-snug text-muted-foreground">
													{n.body}
												</div>
											</div>
											<div className="flex shrink-0 flex-col items-end gap-1">
												<span className="text-[0.65rem] text-muted-foreground">
													{formatTime(n.timestamp)}
												</span>
												{!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
											</div>
										</button>
									);
								})}
							</div>
						)}
					</ScrollArea>
				</SheetContent>
			</Sheet>
		);
	}