import type { LucideIcon } from "lucide-react";
	import {
		Home, Briefcase, Code2, BookOpen, Star, Folder, FlaskConical,
		Target, Rocket, Palette, Globe, Zap, Brain, Flame, Lightbulb, Music,
	} from "lucide-react";

	export const WORKSPACE_ICON_MAP: Record<string, LucideIcon> = {
		"🏠": Home,
		"💼": Briefcase,
		"💻": Code2,
		"📚": BookOpen,
		"⭐": Star,
		"📁": Folder,
		"🔬": FlaskConical,
		"🎯": Target,
		"🚀": Rocket,
		"🎨": Palette,
		"🌍": Globe,
		"⚡": Zap,
		"🧠": Brain,
		"🔥": Flame,
		"💡": Lightbulb,
		"🎵": Music,
	};

	export function workspaceIcon(emoji: string): LucideIcon {
		return WORKSPACE_ICON_MAP[emoji] ?? Folder;
	}