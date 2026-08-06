import { useState, type ComponentType } from "react";
	import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
	import { Button } from "@/components/ui/button";
	import { Progress } from "@/components/ui/progress";
	import { cn } from "@/lib/utils";
	import {
		ArrowRight, Sparkles, Folder, Bot, Settings, Keyboard, Rocket,
	} from "lucide-react";

	interface Step {
		icon: ComponentType<{ className?: string }>;
		title: string;
		desc: string;
		hint?: string | undefined;
	}

	const STEPS: Step[] = [
		{ icon: Sparkles, title: "Welcome to Meridian", desc: "A powerful AI agent that lives on your desktop. Ask questions, write code, manage files, run commands â€” all in one place.", hint: "Let's take a quick tour. You can skip anytime." },
		{ icon: Folder, title: "Workspaces", desc: "Organize your work into Workspaces. Each workspace has its own conversations, instructions, and working directory.", hint: "Right-click a workspace to edit it, or click + to create one." },
		{ icon: Bot, title: "The Agent", desc: "Meridian's agent can read and write files, run shell commands, search the web, and remember things across sessions â€” all with your approval.", hint: "Set a working directory in Settings â†’ General so the agent knows where your project lives." },
		{ icon: Settings, title: "Settings & Personalization", desc: "Add custom instructions, set a nickname, manage memories, and choose a theme that fits your style.", hint: "Open Settings with the gear icon or press Ctrl+K and search 'settings'." },
		{ icon: Keyboard, title: "Keyboard Shortcuts", desc: "Press Ctrl+K to open the command palette. Ctrl+/ focuses the chat input. Shift+Enter for new lines while typing.", hint: "The agent can queue multiple instructions while it's working â€” just keep typing." },
		{ icon: Rocket, title: "You're ready", desc: "That's everything. Start a conversation and see what Meridian can do for you.", hint: undefined },
	];

	interface Props {
		onDone: () => void;
	}

	export default function WelcomeWalkthrough({ onDone }: Props) {
		const [step, setStep] = useState(0);
		const isLast = step === STEPS.length - 1;
		const current = STEPS[step];
		const progress = (step / (STEPS.length - 1)) * 100;

		if (!current) return null;
		const Icon = current.icon;

		return (
			<Dialog open onOpenChange={(o) => { if (!o) onDone(); }}>
				<DialogContent className="max-w-md gap-0 p-0">
					<div className="px-6 pt-6">
						<div className="mb-3 flex justify-center gap-2">
							{STEPS.map((_, i) => (
								<button
									key={i}
									type="button"
									onClick={() => setStep(i)}
									aria-label={`Step ${i + 1}`}
									className={cn(
										"h-2 w-2 rounded-full transition-all hover:scale-150",
										i === step ? "scale-125 bg-primary" : i < step ? "bg-primary/50" : "bg-border",
									)}
								/>
							))}
						</div>
						<Progress value={progress} className="h-1" />
					</div>

					<div className="flex flex-col items-center gap-3 px-6 pb-4 pt-6 text-center">
						<Icon className="h-14 w-14 text-primary" />
						<h2 className="text-xl font-bold">{current.title}</h2>
						<p className="max-w-md text-sm text-muted-foreground">{current.desc}</p>
						{current.hint && (
							<div className="w-full rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-left text-xs text-sky-500">
								{current.hint}
							</div>
						)}
					</div>

					<DialogFooter className="border-t border-border px-6 py-3 sm:justify-between">
						<Button variant="ghost" onClick={onDone} className="text-muted-foreground">Skip</Button>
						<div className="flex gap-2">
							{step > 0 && (
								<Button variant="outline" onClick={() => setStep(s => s - 1)}>Back</Button>
							)}
							<Button onClick={() => (isLast ? onDone() : setStep(s => s + 1))}>
								{isLast ? "Get started" : (
									<>
										Next
										<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
									</>
								)}
							</Button>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}
