const fs = require("fs");

function normLF(s) { return s.replace(/\r\n/g, "\n"); }
function patch(file, find, replace, label) {
	const raw = fs.readFileSync(file, "utf8");
	const wasCRLF = raw.includes("\r\n");
	const lf = normLF(raw);
	if (!lf.includes(find)) throw new Error(`${label}: find not in ${file}`);
	const out = lf.replace(find, replace);
	fs.writeFileSync(file, wasCRLF ? out.replace(/\n/g, "\r\n") : out, "utf8");
	console.log("OK:", label);
}

// 1. Add updateConvFile to store
patch("src/stores/useAppStore.ts",
`  const renameConvFile = useCallback((convId: string, fileId: string, newName: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, files: (c.files ?? []).map(f => f.id === fileId ? { ...f, name: newName } : f), updatedAt: Date.now() }
        : c
    ));
  }, []);`,
`  const renameConvFile = useCallback((convId: string, fileId: string, newName: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, files: (c.files ?? []).map(f => f.id === fileId ? { ...f, name: newName } : f), updatedAt: Date.now() }
        : c
    ));
  }, []);

  const updateConvFile = useCallback((convId: string, fileId: string, content: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, files: (c.files ?? []).map(f => f.id === fileId ? { ...f, content, size: content.length } : f), updatedAt: Date.now() }
        : c
    ));
  }, []);`,
	"store updateConvFile");

// 2. Runner: add rename callback to AgentCallbacks
patch("src/lib/agentRunner.ts",
`  onConvFileRead?: (name: string) => { content: string; mimeType: string; isBinary: boolean } | null;
  onConvFileUpdate?: (name: string, content: string) => boolean;
  onConvFileDelete?: (name: string) => boolean;
  onConvFileList?: () => Array<{ name: string; size: number; mimeType: string; source: string }>;`,
`  onConvFileRead?: (name: string) => { content: string; mimeType: string; isBinary: boolean } | null;
  onConvFileUpdate?: (name: string, content: string) => boolean;
  onConvFileDelete?: (name: string) => boolean;
  onConvFileRename?: (oldName: string, newName: string) => boolean;
  onConvFileList?: () => Array<{ name: string; size: number; mimeType: string; source: string }>;`,
	"runner rename callback");

// 3. App.tsx: wire all five callbacks
patch("src/App.tsx",
`			onConvFileAdded: (file) => {
				store.addConvFile(convId, {
					name: file.name,
					path: file.path,
					mimeType: file.mimeType,
					size: file.size,
					content: file.content,
					isBinary: file.isBinary,
					source: "agent",
				});
			},
			onDone: () => {`,
`			onConvFileAdded: (file) => {
				store.addConvFile(convId, {
					name: file.name,
					path: file.path,
					mimeType: file.mimeType,
					size: file.size,
					content: file.content,
					isBinary: file.isBinary,
					source: "agent",
				});
			},
			onConvFileRead: (name) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === name);
				if (!f) return null;
				return { content: f.content, mimeType: f.mimeType, isBinary: f.isBinary };
			},
			onConvFileUpdate: (name, content) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === name);
				if (!f) return false;
				store.updateConvFile(convId, f.id, content);
				return true;
			},
			onConvFileDelete: (name) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === name);
				if (!f) return false;
				store.removeConvFile(convId, f.id);
				return true;
			},
			onConvFileRename: (oldName, newName) => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				const f = c?.files?.find(f => f.name === oldName);
				if (!f) return false;
				store.renameConvFile(convId, f.id, newName);
				return true;
			},
			onConvFileList: () => {
				const c = storeRef.current.conversations.find(c => c.id === convId);
				return (c?.files ?? []).map(f => ({ name: f.name, size: f.size, mimeType: f.mimeType, source: f.source }));
			},
			onDone: () => {`,
	"app.tsx callbacks");

// 4. Dispatcher: add conv: prefix helpers + save-to-conversation + rename-conv-file
patch("src/lib/agentRunner.ts",
`  const bd = baseDir || undefined;
  switch (name) {
    case "read-file": {`,
`  const bd = baseDir || undefined;

  const isConvPath = (p) => typeof p === "string" && p.startsWith("conv:");
  const convName = (p) => p.slice(5);
  const guessConvMime = (fname) => {
    const ext = fname.toLowerCase().split(".").pop() || "";
    const map = { txt: "text/plain", md: "text/markdown", json: "application/json", js: "text/javascript", ts: "text/typescript", tsx: "text/typescript", py: "text/x-python", html: "text/html", css: "text/css", csv: "text/csv", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml", lua: "text/x-lua", rs: "text/x-rust", go: "text/x-go" };
    return map[ext] || "text/plain";
  };

  switch (name) {
    case "save-to-conversation": {
      const fname = params.name || params.path || "untitled.txt";
      const content = params.body ?? params.content ?? "";
      if (!cb.onConvFileAdded) return "ERROR: save-to-conversation not available here";
      cb.onConvFileAdded({ name: fname, path: \`conv:\${fname}\`, mimeType: guessConvMime(fname), size: content.length, content, isBinary: false });
      return \`Saved to conversation: \${fname} (\${content.length} bytes)\`;
    }
    case "rename-conv-file": {
      const oldName = params.from || params.old || params.name;
      const newName = params.to || params.new;
      if (!oldName || !newName) return "ERROR: rename-conv-file requires 'from' and 'to' attributes";
      if (!cb.onConvFileRename) return "ERROR: rename not available here";
      const ok = cb.onConvFileRename(oldName, newName);
      return ok ? \`Renamed: \${oldName} -> \${newName}\` : \`ERROR: conv file not found: \${oldName}\`;
    }
    case "list-conv-files": {
      if (!cb.onConvFileList) return "ERROR: not available here";
      const list = cb.onConvFileList();
      if (list.length === 0) return "(no conversation files)";
      return list.map(f => \`\${f.name} (\${f.size}b, \${f.mimeType}, \${f.source})\`).join("\\n");
    }
    case "read-file": {
      if (isConvPath(params.path) && cb.onConvFileRead) {
        const f = cb.onConvFileRead(convName(params.path));
        if (!f) return \`ERROR: conv file not found: \${convName(params.path)}\`;
        return f.content;
      }`,
	"dispatcher conv: routing + new tools");

// 5. write-file conv: branch
patch("src/lib/agentRunner.ts",
`    case "write-file": {
      const raw = params.body ?? params.content ?? "";
      const clean = await sanitizeWriteContent(raw, params.path, bd);`,
`    case "write-file": {
      const raw = params.body ?? params.content ?? "";
      if (isConvPath(params.path) && cb.onConvFileRead && cb.onConvFileAdded && cb.onConvFileUpdate) {
        const fname = convName(params.path);
        const existing = cb.onConvFileRead(fname);
        if (existing) { cb.onConvFileUpdate(fname, raw); return \`Updated conv file: \${fname}\`; }
        cb.onConvFileAdded({ name: fname, path: params.path, mimeType: guessConvMime(fname), size: raw.length, content: raw, isBinary: false });
        return \`Created conv file: \${fname}\`;
      }
      const clean = await sanitizeWriteContent(raw, params.path, bd);`,
	"write-file conv branch");

// 6. edit-file conv: branch
patch("src/lib/agentRunner.ts",
`      if (!findStr) {
        return "ERROR: edit-file requires either a non-empty 'find' attribute, or a body containing <<<FIND>>>...<<<REPLACE>>>...<<<END>>> sentinels.";
      }
      const guard = await guardUniqueMatch(params.path, findStr, bd, "edit-file");`,
`      if (!findStr) {
        return "ERROR: edit-file requires either a non-empty 'find' attribute, or a body containing <<<FIND>>>...<<<REPLACE>>>...<<<END>>> sentinels.";
      }
      if (isConvPath(params.path) && cb.onConvFileRead && cb.onConvFileUpdate) {
        const fname = convName(params.path);
        const f = cb.onConvFileRead(fname);
        if (!f) return \`ERROR: conv file not found: \${fname}\`;
        const matches = f.content.split(findStr).length - 1;
        if (matches === 0) return \`ERROR: find string did not match in conv file \${fname}\`;
        if (matches > 1) return \`ERROR: find matched \${matches} locations in conv file \${fname}. Add more context or use replace-all-in-file.\`;
        cb.onConvFileUpdate(fname, f.content.replace(findStr, rawReplace));
        return \`Edited conv file: \${fname}\`;
      }
      const guard = await guardUniqueMatch(params.path, findStr, bd, "edit-file");`,
	"edit-file conv branch");

// 7. replace-all-in-file conv: branch
patch("src/lib/agentRunner.ts",
`      if (!findStr) {
        return "ERROR: replace-all-in-file requires either a non-empty 'find' attribute, or a body containing <<<FIND>>>...<<<REPLACE>>>...<<<END>>> sentinels.";
      }
      const guard = await guardAnyMatch(params.path, findStr, bd, "replace-all-in-file");`,
`      if (!findStr) {
        return "ERROR: replace-all-in-file requires either a non-empty 'find' attribute, or a body containing <<<FIND>>>...<<<REPLACE>>>...<<<END>>> sentinels.";
      }
      if (isConvPath(params.path) && cb.onConvFileRead && cb.onConvFileUpdate) {
        const fname = convName(params.path);
        const f = cb.onConvFileRead(fname);
        if (!f) return \`ERROR: conv file not found: \${fname}\`;
        if (!f.content.includes(findStr)) return \`ERROR: find string did not match in conv file \${fname}\`;
        cb.onConvFileUpdate(fname, f.content.split(findStr).join(rawReplace));
        return \`Replaced all in conv file: \${fname}\`;
      }
      const guard = await guardAnyMatch(params.path, findStr, bd, "replace-all-in-file");`,
	"replace-all conv branch");

// 8. append-file conv: branch
patch("src/lib/agentRunner.ts",
`    case "append-file": {
      const raw = params.body ?? params.content ?? "";
      const clean = await sanitizeWriteContent(raw, params.path, bd);`,
`    case "append-file": {
      const raw = params.body ?? params.content ?? "";
      if (isConvPath(params.path) && cb.onConvFileRead && cb.onConvFileUpdate && cb.onConvFileAdded) {
        const fname = convName(params.path);
        const existing = cb.onConvFileRead(fname);
        if (existing) { cb.onConvFileUpdate(fname, existing.content + raw); return \`Appended to conv file: \${fname}\`; }
        cb.onConvFileAdded({ name: fname, path: params.path, mimeType: guessConvMime(fname), size: raw.length, content: raw, isBinary: false });
        return \`Created conv file: \${fname}\`;
      }
      const clean = await sanitizeWriteContent(raw, params.path, bd);`,
	"append-file conv branch");

// 9. delete-file conv: branch
patch("src/lib/agentRunner.ts",
`    case "delete-file":
      return invoke<string>("tool_delete_file", { path: params.path, baseDir: bd });`,
`    case "delete-file":
      if (isConvPath(params.path) && cb.onConvFileDelete) {
        const ok = cb.onConvFileDelete(convName(params.path));
        return ok ? \`Deleted conv file: \${convName(params.path)}\` : \`ERROR: conv file not found: \${convName(params.path)}\`;
      }
      return invoke<string>("tool_delete_file", { path: params.path, baseDir: bd });`,
	"delete-file conv branch");

console.log("All patches landed.");