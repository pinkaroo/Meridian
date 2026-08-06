// Neutralize tool-syntax fragments that may appear in user-controlled or agent-controlled
// strings before they get injected into the system prompt or conversation history.
//
// Without this, any literal open-tag the model sees in its own context (memories, workspace
// prompts, user instructions, prior assistant prose) can prime spurious dispatches on the
// next turn. The live stream parser only sees fresh model output, never historical or
// injected content, so this rewrite affects only what the model perceives — not what the
// runner actually executes.
//
// The fullwidth bracket characters (U+3014, U+3015) are visually similar but parser-inert.

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