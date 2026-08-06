const fs = require("fs");

function normLF(s) { return s.replace(/\r\n/g, "\n"); }
function patch(file, find, replace, label) {
	const raw = fs.readFileSync(file, "utf8");
	const wasCRLF = raw.includes("\r\n");
	const lf = normLF(raw);
	if (!lf.includes(find)) throw new Error(`${label}: find not in ${file}`);
	const count = lf.split(find).length - 1;
	if (count > 1) throw new Error(`${label}: matched ${count}x in ${file}`);
	const out = lf.replace(find, replace);
	fs.writeFileSync(file, wasCRLF ? out.replace(/\n/g, "\r\n") : out, "utf8");
	console.log("OK:", label);
}

// Add all 6 callbacks to AgentCallbacks interface
patch("src/lib/agentRunner.ts",
`  onConsumeQueued?: () => { content: string; attachments?: Attachment[] } | null | undefined;
}`,
`  onConsumeQueued?: () => { content: string; attachments?: Attachment[] } | null | undefined;
  onConvFileAdded?: (file: { name: string; path: string; mimeType: string; size: number; content: string; isBinary: boolean }) => void;
  onConvFileRead?: (name: string) => { content: string; mimeType: string; isBinary: boolean } | null;
  onConvFileUpdate?: (name: string, content: string) => boolean;
  onConvFileDelete?: (name: string) => boolean;
  onConvFileRename?: (oldName: string, newName: string) => boolean;
  onConvFileList?: () => Array<{ name: string; size: number; mimeType: string; source: string }>;
}`,
	"runner callbacks");

console.log("Done.");