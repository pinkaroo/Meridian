import type { LucideIcon } from "lucide-react";
	import {
		Home, Briefcase, Code2, BookOpen, Star, Folder, FlaskConical,
		Target, Rocket, Palette, Globe, Zap, Brain, Flame, Lightbulb, Music,
	} from "lucide-react";

	export const WORKSPACE_ICON_MAP: Record<string, LucideIcon> = {
		"ðŸ ": Home,
		"ðŸ’¼": Briefcase,
		"ðŸ’»": Code2,
		"ðŸ“š": BookOpen,
		"â­": Star,
		"ðŸ“": Folder,
		"ðŸ”¬": FlaskConical,
		"ðŸŽ¯": Target,
		"ðŸš€": Rocket,
		"ðŸŽ¨": Palette,
		"ðŸŒ": Globe,
		"âš¡": Zap,
		"ðŸ§ ": Brain,
		"ðŸ”¥": Flame,
		"ðŸ’¡": Lightbulb,
		"ðŸŽµ": Music,
	};

	export function workspaceIcon(emoji: string): LucideIcon {
		return WORKSPACE_ICON_MAP[emoji] ?? Folder;
	}
