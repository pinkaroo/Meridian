import type { ReactNode } from "react";

interface OpenSailShellProps {
	navigation: ReactNode;
	children: ReactNode;
}

export default function OpenSailShell({ navigation, children }: OpenSailShellProps) {
	return (
		<div className="opensail-shell flex h-screen w-screen gap-2 overflow-hidden bg-[#090909] p-2 text-foreground">
			<aside className="opensail-navigation h-full shrink-0 overflow-hidden rounded-xl border border-[#1c1e21] bg-[#090909]">
				{navigation}
			</aside>
			<main className="opensail-workspace app-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#1c1e21] bg-[#0f0f11]">
				{children}
			</main>
		</div>
	);
}
