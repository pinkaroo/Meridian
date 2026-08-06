
const OPEN = String.fromCharCode(91);
const CLOSE = String.fromCharCode(93);

const openTagRx = new RegExp("\\" + OPEN + "\\s*TOOL\\s*:", "g");
const closeTagRx = new RegExp("\\" + OPEN + "\\/TOOL\\s*\\" + CLOSE, "g");

export function sanitizeForPrompt(text: string): string {
	if (!text) return text;
	return text
		.replace(openTagRx, "\u3014TOOL:")
		.replace(closeTagRx, "\u3014/TOOL\u3015");
}
