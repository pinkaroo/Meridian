export type ParserEvent =
	| { type: "text"; text: string }
	| { type: "thinking_start"; id: string }
	| { type: "thinking_delta"; id: string; text: string }
	| { type: "thinking_end"; id: string }
	| { type: "tool_start"; id: string; name: string; attrs: Record<string, string> }
	| { type: "tool_body_delta"; id: string; text: string }
	| { type: "tool_end"; id: string; name: string; attrs: Record<string, string>; body: string };

type State = "TEXT" | "IN_BODY";

interface CurrentTool {
	id: string;
	name: string;
	attrs: Record<string, string>;
	body: string;
	isThinking: boolean;
}

const TOOL_PREFIX = "[" + "TOOL:";
const TOOL_CLOSE = "[" + "/TOOL]";

function findTagClose(s: string, startAt: number): number {
	let i = startAt;
	let inQuote = false;
	while (i < s.length) {
		const ch = s[i];
		if (inQuote) {
			if (ch === "\\" && i + 1 < s.length) { i += 2; continue; }
			if (ch === '"') { inQuote = false; i += 1; continue; }
			i += 1;
			continue;
		}
		if (ch === '"') { inQuote = true; i += 1; continue; }
		if (ch === "]") return i;
		i += 1;
	}
	return -1;
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /([a-zA-Z][a-zA-Z0-9_-]*)="((?:[^"\\]|\\[\s\S])*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw)) !== null) {
		attrs[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
	}
	return attrs;
}

export class StreamParser {
	private state: State = "TEXT";
	private pending = "";
	private currentTool: CurrentTool | null = null;
	private idCounter = 0;

	private nextId(prefix: string): string {
		this.idCounter += 1;
		return `${prefix}-${Date.now().toString(36)}-${this.idCounter}`;
	}

	feed(chunk: string): ParserEvent[] {
		const events: ParserEvent[] = [];
		this.pending += chunk;
		let progress = true;
		while (progress) progress = this.step(events);
		return events;
	}

	end(): ParserEvent[] {
		const events: ParserEvent[] = [];
		if (this.state === "TEXT" && this.pending.length > 0) {
			events.push({ type: "text", text: this.pending });
			this.pending = "";
		}
		if (this.currentTool) {
			const tool = this.currentTool;
			const body = tool.body.trim();
			if (tool.isThinking) {
				events.push({ type: "thinking_end", id: tool.id });
			} else {
				events.push({ type: "tool_end", id: tool.id, name: tool.name, attrs: tool.attrs, body });
			}
			this.currentTool = null;
		}
		return events;
	}

	private step(events: ParserEvent[]): boolean {
		if (this.state === "TEXT") return this.stepText(events);
		return this.stepInBody(events);
	}

	private stepText(events: ParserEvent[]): boolean {
		const openIdx = this.pending.indexOf(TOOL_PREFIX);
		if (openIdx === -1) {
			const hold = TOOL_PREFIX.length - 1;
			if (this.pending.length > hold) {
				const emit = this.pending.slice(0, this.pending.length - hold);
				events.push({ type: "text", text: emit });
				this.pending = this.pending.slice(this.pending.length - hold);
				return true;
			}
			return false;
		}
		if (openIdx > 0) {
			events.push({ type: "text", text: this.pending.slice(0, openIdx) });
			this.pending = this.pending.slice(openIdx);
			return true;
		}

		const closeIdx = findTagClose(this.pending, TOOL_PREFIX.length);
		if (closeIdx === -1) {
			if (this.pending.length > 131072) {
				events.push({ type: "text", text: this.pending });
				this.pending = "";
				return false;
			}
			return false;
		}

		const tagInner = this.pending.slice(TOOL_PREFIX.length, closeIdx).trim();
		const spaceIdx = tagInner.indexOf(" ");
		const name = spaceIdx === -1 ? tagInner : tagInner.slice(0, spaceIdx);
		const attrsRaw = spaceIdx === -1 ? "" : tagInner.slice(spaceIdx + 1);
		const attrs = parseAttrs(attrsRaw);

		const isThinking = name === "thinking";
		const id = this.nextId(isThinking ? "th" : "tc");
		this.currentTool = { id, name, attrs, body: "", isThinking };

		if (isThinking) {
			events.push({ type: "thinking_start", id });
		} else {
			events.push({ type: "tool_start", id, name, attrs });
		}

		this.pending = this.pending.slice(closeIdx + 1);
		if (this.pending.startsWith("\n")) this.pending = this.pending.slice(1);
		this.state = "IN_BODY";
		return true;
	}

	private stepInBody(events: ParserEvent[]): boolean {
		if (!this.currentTool) {
			this.state = "TEXT";
			return true;
		}

		const closeIdx = this.pending.indexOf(TOOL_CLOSE);
		if (closeIdx === -1) {
			const hold = TOOL_CLOSE.length - 1;
			if (this.pending.length > hold) {
				const emit = this.pending.slice(0, this.pending.length - hold);
				this.pending = this.pending.slice(this.pending.length - hold);
				this.currentTool.body += emit;
				if (emit.length > 0) {
					if (this.currentTool.isThinking) {
						events.push({ type: "thinking_delta", id: this.currentTool.id, text: emit });
					} else {
						events.push({ type: "tool_body_delta", id: this.currentTool.id, text: emit });
					}
					return true;
				}
			}
			return false;
		}

		const raw = this.pending.slice(0, closeIdx);
		const content = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
		this.currentTool.body += content;

		const tool = this.currentTool;
		const body = tool.body.trim();

		if (content.length > 0) {
			if (tool.isThinking) {
				events.push({ type: "thinking_delta", id: tool.id, text: content });
			} else {
				events.push({ type: "tool_body_delta", id: tool.id, text: content });
			}
		}

		if (tool.isThinking) {
			events.push({ type: "thinking_end", id: tool.id });
		} else {
			events.push({ type: "tool_end", id: tool.id, name: tool.name, attrs: tool.attrs, body });
		}

		this.currentTool = null;
		this.pending = this.pending.slice(closeIdx + TOOL_CLOSE.length);
		this.state = "TEXT";
		return true;
	}
}
