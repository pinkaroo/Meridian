const fs = require("fs");
const p = "src/lib/agentRunner.ts";
let s = fs.readFileSync(p, "utf8");
const norm = s.replace(/\r\n/g, "\n");

const badFind = `async function streamOneTurn(args: StreamTurnArgs): Promise<{ fullText: string; toolCalls: ParsedToolCall[] }> {
  if (name === "present-file") {
    const fname = params.name || "untitled.txt";
    const content = params.body ?? params.content ?? "";
    const mimeType = params.mimeType || guessConvMime(fname);
    cb.onMessageUpdate(assistantMsgId, (msg) => {
      const segs = [...(msg.segments ?? [])];
      // Drop the pending tool segment for this present-file call -- we render
      // a file card instead, no need for a tool result block.
      const toolIdx = segs.findIndex(s => s.kind === "tool" && s.call.id === toolId);
      if (toolIdx >= 0) segs.splice(toolIdx, 1);
      segs.push({ kind: "file", name: fname, content, mimeType, size: content.length });
      return { segments: segs };
    });
    return { text: \`Presented file: \${fname} (\${content.length} bytes)\`, ok: true };
  }

  const MAX_RETRIES = 3;`;

const badRep = `async function streamOneTurn(args: StreamTurnArgs): Promise<{ fullText: string; toolCalls: ParsedToolCall[] }> {
  const MAX_RETRIES = 3;`;

if (!norm.includes(badFind)) {
	console.error("bad block not found - already cleaned?");
	process.exit(1);
}
let patched = norm.replace(badFind, badRep);
fs.writeFileSync(p, patched.replace(/\n/g, "\r\n"));
console.log("bad block removed");