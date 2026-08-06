const fs = require("fs");

function normLF(s) { return s.replace(/\r\n/g, "\n"); }
function patch(file, find, replace, label) {
	const raw = fs.readFileSync(file, "utf8");
	const wasCRLF = raw.includes("\r\n");
	const lf = normLF(raw);
	if (!lf.includes(find)) throw new Error(`${label}: find not in ${file}`);
	const count = lf.split(find).length - 1;
	if (count > 1) throw new Error(`${label}: find matched ${count} times in ${file}`);
	const out = lf.replace(find, replace);
	fs.writeFileSync(file, wasCRLF ? out.replace(/\n/g, "\r\n") : out, "utf8");
	console.log("OK:", label);
}

// 1. Add the 5 conv-file callbacks to AgentCallbacks
patch("src/lib/agentRunner.ts",
`  onConvFileAdded?: (file: { name: string; path: string; mimeType: string; size: number; content: string; isBinary: boolean }) => void;`,
`  onConvFileAdded?: (file: { name: string; path: string; mimeType: string; size: number; content: string; isBinary: boolean }) => void;
  onConvFileRead?: (name: string) => { content: string; mimeType: string; isBinary: boolean } | null;
  onConvFileUpdate?: (name: string, content: string) => boolean;
  onConvFileDelete?: (name: string) => boolean;
  onConvFileRename?: (oldName: string, newName: string) => boolean;
  onConvFileList?: () => Array<{ name: string; size: number; mimeType: string; source: string }>;`,
	"runner callbacks");

// 2. Intercept conv: + new tools in executeTool BEFORE the dispatch loop
patch("src/lib/agentRunner.ts",
`  const MAX_RETRIES = 3;
  let lastResult = "";
  let lastErr: unknown = null;
  let emptyRetried = false;`,
`  // conv: prefix routes file ops to the conversation's file panel instead of disk
  const isConvPath = (p: string | undefined): p is string => typeof p === "string" && p.startsWith("conv:");
  const convFileName = (p: string) => p.slice(5);
  const guessConvMime = (fname: string): string => {
    const ext = fname.toLowerCase().split(".").pop() || "";
    const map: Record<string, string> = { txt: "text/plain", md: "text/markdown", json: "application/json", js: "text/javascript", ts: "text/typescript", tsx: "text/typescript", jsx: "text/javascript", py: "text/x-python", html: "text/html", css: "text/css", csv: "text/csv", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml", lua: "text/x-lua", rs: "text/x-rust", go: "text/x-go", sh: "text/x-shellscript", bat: "text/x-batch" };
    return map[ext] || "text/plain";
  };

  // New conv-only tools (always intercepted, never hit dispatcher)
  if (name === "save-to-conversation") {
    const fname = params.name || params.path || "untitled.txt";
    const content = params.body ?? params.content ?? "";
    if (!cb.onConvFileAdded) return finishTool(cb, assistantMsgId, toolId, "", "save-to-conversation not available in this context", "error");
    cb.onConvFileAdded({ name: fname, path: \`conv:\${fname}\`, mimeType: guessConvMime(fname), size: content.length, content, isBinary: false });
    return finishTool(cb, assistantMsgId, toolId, \`Saved to conversation: \${fname} (\${content.length} bytes)\`, undefined, "complete");
  }
  if (name === "rename-conv-file") {
    const oldName = params.from || params.old || params.name;
    const newName = params.to || params.new;
    if (!oldName || !newName) return finishTool(cb, assistantMsgId, toolId, "", "rename-conv-file requires 'from' and 'to' attributes", "error");
    if (!cb.onConvFileRename) return finishTool(cb, assistantMsgId, toolId, "", "rename not available here", "error");
    const ok = cb.onConvFileRename(oldName, newName);
    return finishTool(cb, assistantMsgId, toolId, ok ? \`Renamed: \${oldName} -> \${newName}\` : "", ok ? undefined : \`conv file not found: \${oldName}\`, ok ? "complete" : "error");
  }
  if (name === "list-conv-files") {
    if (!cb.onConvFileList) return finishTool(cb, assistantMsgId, toolId, "", "not available here", "error");
    const list = cb.onConvFileList();
    const out = list.length === 0 ? "(no conversation files)" : list.map(f => \`\${f.name} (\${f.size}b, \${f.mimeType}, \${f.source})\`).join("\\n");
    return finishTool(cb, assistantMsgId, toolId, out, undefined, "complete");
  }

  // Standard file tools with conv: prefix - intercept before dispatch
  if (isConvPath(params.path)) {
    const fname = convFileName(params.path);
    if (name === "read-file" || name === "read-file-range") {
      if (!cb.onConvFileRead) return finishTool(cb, assistantMsgId, toolId, "", "conv file read not available", "error");
      const f = cb.onConvFileRead(fname);
      if (!f) return finishTool(cb, assistantMsgId, toolId, "", \`conv file not found: \${fname}\`, "error");
      return finishTool(cb, assistantMsgId, toolId, f.content, undefined, "complete");
    }
    if (name === "write-file") {
      const raw = params.body ?? params.content ?? "";
      if (!cb.onConvFileRead || !cb.onConvFileAdded || !cb.onConvFileUpdate) return finishTool(cb, assistantMsgId, toolId, "", "conv file ops not available", "error");
      const existing = cb.onConvFileRead(fname);
      if (existing) { cb.onConvFileUpdate(fname, raw); return finishTool(cb, assistantMsgId, toolId, \`Updated conv file: \${fname} (\${raw.length} bytes)\`, undefined, "complete"); }
      cb.onConvFileAdded({ name: fname, path: params.path, mimeType: guessConvMime(fname), size: raw.length, content: raw, isBinary: false });
      return finishTool(cb, assistantMsgId, toolId, \`Created conv file: \${fname} (\${raw.length} bytes)\`, undefined, "complete");
    }
    if (name === "append-file") {
      const raw = params.body ?? params.content ?? "";
      if (!cb.onConvFileRead || !cb.onConvFileUpdate || !cb.onConvFileAdded) return finishTool(cb, assistantMsgId, toolId, "", "conv file ops not available", "error");
      const existing = cb.onConvFileRead(fname);
      if (existing) { cb.onConvFileUpdate(fname, existing.content + raw); return finishTool(cb, assistantMsgId, toolId, \`Appended to conv file: \${fname}\`, undefined, "complete"); }
      cb.onConvFileAdded({ name: fname, path: params.path, mimeType: guessConvMime(fname), size: raw.length, content: raw, isBinary: false });
      return finishTool(cb, assistantMsgId, toolId, \`Created conv file: \${fname}\`, undefined, "complete");
    }
    if (name === "edit-file") {
      const parsed = parseBodyFindReplace(params.body);
      const findStr = parsed ? parsed.find : (params.find ?? "");
      const rawReplace = parsed ? parsed.replace : (params.body ?? params.replace ?? "");
      if (!findStr) return finishTool(cb, assistantMsgId, toolId, "", "edit-file requires 'find' attribute or body sentinels", "error");
      if (!cb.onConvFileRead || !cb.onConvFileUpdate) return finishTool(cb, assistantMsgId, toolId, "", "conv file ops not available", "error");
      const f = cb.onConvFileRead(fname);
      if (!f) return finishTool(cb, assistantMsgId, toolId, "", \`conv file not found: \${fname}\`, "error");
      const matches = f.content.split(findStr).length - 1;
      if (matches === 0) return finishTool(cb, assistantMsgId, toolId, "", \`find string did not match in conv file \${fname}\`, "error");
      if (matches > 1) return finishTool(cb, assistantMsgId, toolId, "", \`find matched \${matches} locations in conv file \${fname}. Add more context or use replace-all-in-file.\`, "error");
      cb.onConvFileUpdate(fname, f.content.replace(findStr, rawReplace));
      return finishTool(cb, assistantMsgId, toolId, \`Edited conv file: \${fname}\`, undefined, "complete");
    }
    if (name === "replace-all-in-file") {
      const parsed = parseBodyFindReplace(params.body);
      const findStr = parsed ? parsed.find : (params.find ?? "");
      const rawReplace = parsed ? parsed.replace : (params.body ?? params.replace ?? "");
      if (!findStr) return finishTool(cb, assistantMsgId, toolId, "", "replace-all-in-file requires 'find' attribute or body sentinels", "error");
      if (!cb.onConvFileRead || !cb.onConvFileUpdate) return finishTool(cb, assistantMsgId, toolId, "", "conv file ops not available", "error");
      const f = cb.onConvFileRead(fname);
      if (!f) return finishTool(cb, assistantMsgId, toolId, "", \`conv file not found: \${fname}\`, "error");
      if (!f.content.includes(findStr)) return finishTool(cb, assistantMsgId, toolId, "", \`find string did not match in conv file \${fname}\`, "error");
      cb.onConvFileUpdate(fname, f.content.split(findStr).join(rawReplace));
      return finishTool(cb, assistantMsgId, toolId, \`Replaced all in conv file: \${fname}\`, undefined, "complete");
    }
    if (name === "delete-file") {
      if (!cb.onConvFileDelete) return finishTool(cb, assistantMsgId, toolId, "", "conv file delete not available", "error");
      const ok = cb.onConvFileDelete(fname);
      return finishTool(cb, assistantMsgId, toolId, ok ? \`Deleted conv file: \${fname}\` : "", ok ? undefined : \`conv file not found: \${fname}\`, ok ? "complete" : "error");
    }
    if (name === "file-exists") {
      const exists = cb.onConvFileRead ? cb.onConvFileRead(fname) !== null : false;
      return finishTool(cb, assistantMsgId, toolId, exists ? "true" : "false", undefined, "complete");
    }
  }

  const MAX_RETRIES = 3;
  let lastResult = "";
  let lastErr: unknown = null;
  let emptyRetried = false;`,
	"executeTool interception");

// 3. Restore disk-write file mirror in executeTool
patch("src/lib/agentRunner.ts",
`      if (isMutator(name)) {
        cb.onActivity({ type: "file_modified", label: \`\${name} \${params.path || params.destination || ""}\`.trim() });
      } else if (name === "run-command") {`,
`      if (isMutator(name)) {
        cb.onActivity({ type: "file_modified", label: \`\${name} \${params.path || params.destination || ""}\`.trim() });
        // Mirror disk writes into the conv file panel so users can browse what the agent touched
        if (cb.onConvFileAdded && params.path && !isConvPath(params.path) && (name === "write-file" || name === "append-file" || name === "edit-file" || name === "replace-all-in-file")) {
          (async () => {
            try {
              const content = await readFileSafe(params.path, workingDir);
              if (content !== null) {
                const name_ = params.path.split(/[\\\\/]/).pop() || params.path;
                cb.onConvFileAdded!({ name: name_, path: params.path, mimeType: guessConvMime(name_), size: content.length, content, isBinary: false });
              }
            } catch { /* mirror failure is non-fatal */ }
          })();
        }
      } else if (name === "run-command") {`,
	"disk write mirror");

// 4. App.tsx callbacks
patch("src/App.tsx",
`\t\t\tonConvFileAdded: (file) => {
\t\t\t\tstore.addConvFile(convId, {
\t\t\t\t\tname: file.name,
\t\t\t\t\tpath: file.path,
\t\t\t\t\tmimeType: file.mimeType,
\t\t\t\t\tsize: file.size,
\t\t\t\t\tcontent: file.content,
\t\t\t\t\tisBinary: file.isBinary,
\t\t\t\t\tsource: "agent",
\t\t\t\t});
\t\t\t},`,
`\t\t\tonConvFileAdded: (file) => {
\t\t\t\tstore.addConvFile(convId, {
\t\t\t\t\tname: file.name,
\t\t\t\t\tpath: file.path,
\t\t\t\t\tmimeType: file.mimeType,
\t\t\t\t\tsize: file.size,
\t\t\t\t\tcontent: file.content,
\t\t\t\t\tisBinary: file.isBinary,
\t\t\t\t\tsource: "agent",
\t\t\t\t});
\t\t\t},
\t\t\tonConvFileRead: (name) => {
\t\t\t\tconst c = storeRef.current.conversations.find(c => c.id === convId);
\t\t\t\tconst f = c?.files?.find(f => f.name === name);
\t\t\t\tif (!f) return null;
\t\t\t\treturn { content: f.content, mimeType: f.mimeType, isBinary: f.isBinary };
\t\t\t},
\t\t\tonConvFileUpdate: (name, content) => {
\t\t\t\tconst c = storeRef.current.conversations.find(c => c.id === convId);
\t\t\t\tconst f = c?.files?.find(f => f.name === name);
\t\t\t\tif (!f) return false;
\t\t\t\tstore.updateConvFile(convId, f.id, content);
\t\t\t\treturn true;
\t\t\t},
\t\t\tonConvFileDelete: (name) => {
\t\t\t\tconst c = storeRef.current.conversations.find(c => c.id === convId);
\t\t\t\tconst f = c?.files?.find(f => f.name === name);
\t\t\t\tif (!f) return false;
\t\t\t\tstore.removeConvFile(convId, f.id);
\t\t\t\treturn true;
\t\t\t},
\t\t\tonConvFileRename: (oldName, newName) => {
\t\t\t\tconst c = storeRef.current.conversations.find(c => c.id === convId);
\t\t\t\tconst f = c?.files?.find(f => f.name === oldName);
\t\t\t\tif (!f) return false;
\t\t\t\tstore.renameConvFile(convId, f.id, newName);
\t\t\t\treturn true;
\t\t\t},
\t\t\tonConvFileList: () => {
\t\t\t\tconst c = storeRef.current.conversations.find(c => c.id === convId);
\t\t\t\treturn (c?.files ?? []).map(f => ({ name: f.name, size: f.size, mimeType: f.mimeType, source: f.source }));
\t\t\t},`,
	"app.tsx callbacks");

console.log("All patches landed.");