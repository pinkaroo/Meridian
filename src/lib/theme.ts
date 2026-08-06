import type { ShadcnTheme, ColorMode } from "../types";

const THEME_KEY = "meridian-theme";
const MODE_KEY = "meridian-mode";

export const SHADCN_THEMES: Array<{ id: ShadcnTheme; label: string; primary: string; primaryDark: string }> = [
	{ id: "zinc",    label: "Zinc",    primary: "hsl(240 5.9% 10%)",   primaryDark: "hsl(0 0% 98%)" },
	{ id: "slate",   label: "Slate",   primary: "hsl(222.2 47.4% 11.2%)", primaryDark: "hsl(210 40% 98%)" },
	{ id: "stone",   label: "Stone",   primary: "hsl(24 9.8% 10%)",    primaryDark: "hsl(60 9.1% 97.8%)" },
	{ id: "gray",    label: "Gray",    primary: "hsl(220.9 39.3% 11%)", primaryDark: "hsl(210 20% 98%)" },
	{ id: "neutral", label: "Neutral", primary: "hsl(0 0% 9%)",        primaryDark: "hsl(0 0% 98%)" },
	{ id: "red",     label: "Red",     primary: "hsl(0 72.2% 50.6%)",  primaryDark: "hsl(0 72.2% 50.6%)" },
	{ id: "rose",    label: "Rose",    primary: "hsl(346.8 77.2% 49.8%)", primaryDark: "hsl(346.8 77.2% 49.8%)" },
	{ id: "orange",  label: "Orange",  primary: "hsl(24.6 95% 53.1%)", primaryDark: "hsl(20.5 90.2% 48.2%)" },
	{ id: "green",   label: "Green",   primary: "hsl(142.1 76.2% 36.3%)", primaryDark: "hsl(142.1 70.6% 45.3%)" },
	{ id: "blue",    label: "Blue",    primary: "hsl(221.2 83.2% 53.3%)", primaryDark: "hsl(217.2 91.2% 59.8%)" },
	{ id: "yellow",  label: "Yellow",  primary: "hsl(47.9 95.8% 53.1%)", primaryDark: "hsl(47.9 95.8% 53.1%)" },
	{ id: "violet",  label: "Violet",  primary: "hsl(262.1 83.3% 57.8%)", primaryDark: "hsl(263.4 70% 50.4%)" },
];

export function getTheme(): ShadcnTheme {
	try {
		const v = localStorage.getItem(THEME_KEY) as ShadcnTheme | null;
		if (v && SHADCN_THEMES.some(t => t.id === v)) return v;
	} catch {}
	return "neutral";
}

export function getMode(): ColorMode {
	try {
		const v = localStorage.getItem(MODE_KEY);
		return v === "light" ? "light" : "dark";
	} catch {
		return "dark";
	}
}

export function applyTheme(theme: ShadcnTheme, mode: ColorMode) {
	const root = document.documentElement;
	root.setAttribute("data-theme", theme);
	if (mode === "dark") root.classList.add("dark");
	else root.classList.remove("dark");
	try {
		localStorage.setItem(THEME_KEY, theme);
		localStorage.setItem(MODE_KEY, mode);
	} catch {}
	}

export function setTheme(theme: ShadcnTheme) {
	applyTheme(theme, getMode());
}

export function setMode(mode: ColorMode) {
	applyTheme(getTheme(), mode);
}

export function toggleMode() {
	setMode(getMode() === "dark" ? "light" : "dark");
}