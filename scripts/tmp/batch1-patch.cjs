const fs = require("fs");

function patch(file, swaps) {
	const raw = fs.readFileSync(file);
	const hasBOM = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
	let content = raw.toString("utf8");
	const isCRLF = content.includes("\r\n");
	const normalized = content.replace(/\r\n/g, "\n");
	let next = normalized;
	for (const [from, to] of swaps) {
		if (!next.includes(from)) {
			console.error("MISS in", file, "for:", from.slice(0, 80));
			process.exit(1);
		}
		next = next.replace(from, to);
	}
	if (isCRLF) next = next.replace(/\n/g, "\r\n");
	fs.writeFileSync(file, (hasBOM ? "\uFEFF" : "") + next, "utf8");
	console.log("Patched", file);
}

// 1. index.css - checker bg + hover on markdown img
patch("src/index.css", [[
	`\t.markdown-body img {
\t\t@apply max-w-full rounded-md border border-border;
\t}`,
	`\t.markdown-body img {
\t\t@apply max-w-full cursor-zoom-in rounded-md border border-border transition-opacity hover:opacity-90;
\t}

\t.lightbox-checker {
\t\tbackground-color: #1a1a1a;
\t\tbackground-image:
\t\t\tlinear-gradient(45deg, #2a2a2a 25%, transparent 25%),
\t\t\tlinear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
\t\t\tlinear-gradient(45deg, transparent 75%, #2a2a2a 75%),
\t\t\tlinear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
\t\tbackground-size: 20px 20px;
\t\tbackground-position: 0 0, 0 10px, 10px -10px, -10px 0px;
\t}

\t.attachment-checker {
\t\tbackground-color: hsl(var(--muted));
\t\tbackground-image:
\t\t\tlinear-gradient(45deg, hsl(var(--border) / 0.4) 25%, transparent 25%),
\t\t\tlinear-gradient(-45deg, hsl(var(--border) / 0.4) 25%, transparent 25%),
\t\t\tlinear-gradient(45deg, transparent 75%, hsl(var(--border) / 0.4) 75%),
\t\t\tlinear-gradient(-45deg, transparent 75%, hsl(var(--border) / 0.4) 75%);
\t\tbackground-size: 12px 12px;
\t\tbackground-position: 0 0, 0 6px, 6px -6px, -6px 0px;
\t}`,
]]);

// 2. ChatInputBox - import + lightbox hook + bigger thumbnail with click
patch("src/components/ChatInputBox.tsx", [
	[
		`import { isImageFile, isImageMime, processImageFile } from "../lib/imageAttachment";`,
		`import { isImageFile, isImageMime, processImageFile } from "../lib/imageAttachment";
import { useLightbox } from "./ImageLightbox";`,
	],
	[
		`\tconst [localDraft, setLocalDraft] = useState(draft);
\tuseEffect(() => { setLocalDraft(draft); }, [draft]);`,
		`\tconst [localDraft, setLocalDraft] = useState(draft);
\tconst lightbox = useLightbox();
\tuseEffect(() => { setLocalDraft(draft); }, [draft]);`,
	],
	[
		`\t\t\t\t\t\t\t\tif (isImg) {
\t\t\t\t\t\t\t\t\treturn (
\t\t\t\t\t\t\t\t\t\t<div
\t\t\t\t\t\t\t\t\t\t\tkey={att.name + "-" + idx}
\t\t\t\t\t\t\t\t\t\t\tclassName="group/att relative h-14 w-14 overflow-hidden rounded-md border border-border bg-muted"
\t\t\t\t\t\t\t\t\t\t\ttitle={\`\${att.name} - \${formatAttachmentBytes(att.size)}\`}
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t<img src={att.thumbDataUrl} alt={att.name} className="h-full w-full object-cover" />
\t\t\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\t\t\ttype="button"
\t\t\t\t\t\t\t\t\t\t\t\tonClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
\t\t\t\t\t\t\t\t\t\t\t\tclassName="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 opacity-0 transition-opacity group-hover/att:opacity-100 hover:bg-background"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t<X className="h-3 w-3" />
\t\t\t\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t);
\t\t\t\t\t\t\t\t}`,
		`\t\t\t\t\t\t\t\tif (isImg) {
\t\t\t\t\t\t\t\t\treturn (
\t\t\t\t\t\t\t\t\t\t<div
\t\t\t\t\t\t\t\t\t\t\tkey={att.name + "-" + idx}
\t\t\t\t\t\t\t\t\t\t\tclassName="group/att attachment-checker relative h-20 w-20 cursor-zoom-in overflow-hidden rounded-md border border-border transition-transform hover:scale-[1.02]"
\t\t\t\t\t\t\t\t\t\t\ttitle={\`\${att.name} - \${formatAttachmentBytes(att.size)}\`}
\t\t\t\t\t\t\t\t\t\t\tonClick={() => {
\t\t\t\t\t\t\t\t\t\t\t\tconst imgs = attachments.filter(a => isImageMime(a.mimeType, a.name) && !!a.thumbDataUrl);
\t\t\t\t\t\t\t\t\t\t\t\tconst startIdx = imgs.findIndex(a => a === att);
\t\t\t\t\t\t\t\t\t\t\t\tlightbox.open(
\t\t\t\t\t\t\t\t\t\t\t\t\timgs.map(a => ({ src: a.content || a.thumbDataUrl || "", alt: a.name, name: a.name })),
\t\t\t\t\t\t\t\t\t\t\t\t\tMath.max(0, startIdx),
\t\t\t\t\t\t\t\t\t\t\t\t);
\t\t\t\t\t\t\t\t\t\t\t}}
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t<img src={att.thumbDataUrl} alt={att.name} className="h-full w-full object-contain" />
\t\t\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\t\t\ttype="button"
\t\t\t\t\t\t\t\t\t\t\t\tonClick={(e) => { e.stopPropagation(); setAttachments(prev => prev.filter((_, i) => i !== idx)); }}
\t\t\t\t\t\t\t\t\t\t\t\tclassName="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 opacity-0 shadow-sm transition-opacity group-hover/att:opacity-100 hover:bg-background"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t<X className="h-3 w-3" />
\t\t\t\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t);
\t\t\t\t\t\t\t\t}`,
	],
]);

// 3. App.tsx - import LightboxProvider + wrap the root
patch("src/App.tsx", [
	[
		`import McpSettings from "./components/McpSettings";`,
		`import McpSettings from "./components/McpSettings";
import { LightboxProvider } from "./components/ImageLightbox";`,
	],
]);

console.log("All patches landed.");