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

// write-file
patch("src/lib/agentRunner.ts",
`case "write-file": {
      const raw = params.body ?? params.content ?? "";
      const clean = await sanitizeWriteContent(raw, params.path, bd);`,
`case "write-file": {
      const raw = params.body ?? params.content ?? "";
      if (isConvPath(params.path) && cb.onConvFileRead && cb.onConvFileAdded && cb.onConvFileUpdate) {
        const fname = convName(params.path);
        const existing = cb.onConvFileRead(fname);
        if (existing) { cb.onConvFileUpdate(fname, raw); return \`Updated conv file: \${fname}\`; }
        cb.onConvFileAdded({ name: fname, path: params.path, mimeType: guessConvMime(fname), size: raw.length, content: raw, isBinary: false });
        return \`Created conv file: \${fname}\`;
      }
      const clean = await sanitizeWriteContent(raw, params.path, bd);`,
	"write-file");

// append-file
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
	"append-file");

// edit-file
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
        if (matches === 0) return \`ERROR: find did not match in conv file \${fname}\`;
        if (matches > 1) return \`ERROR: find matched \${matches} locations in conv file \${fname}. Add more context or use replace-all-in-file.\`;
        cb.onConvFileUpdate(fname, f.content.replace(findStr, rawReplace));
        return \`Edited conv file: \${fname}\`;
      }
      const guard = await guardUniqueMatch(params.path, findStr, bd, "edit-file");`,
	"edit-file");

// replace-all-in-file
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
        if (!f.content.includes(findStr)) return \`ERROR: find did not match in conv file \${fname}\`;
        cb.onConvFileUpdate(fname, f.content.split(findStr).join(rawReplace));
        return \`Replaced all in conv file: \${fname}\`;
      }
      const guard = await guardAnyMatch(params.path, findStr, bd, "replace-all-in-file");`,
	"replace-all-in-file");

// delete-file
patch("src/lib/agentRunner.ts",
`    case "delete-file":
      return invoke<string>("tool_delete_file", { path: params.path, baseDir: bd });`,
`    case "delete-file":
      if (isConvPath(params.path) && cb.onConvFileDelete) {
        const ok = cb.onConvFileDelete(convName(params.path));
        return ok ? \`Deleted conv file: \${convName(params.path)}\` : \`ERROR: conv file not found: \${convName(params.path)}\`;
      }
      return invoke<string>("tool_delete_file", { path: params.path, baseDir: bd });`,
	"delete-file");

console.log("All branch patches landed.");