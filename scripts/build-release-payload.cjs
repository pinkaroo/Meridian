// Builds a GitHub release JSON payload with multi-line markdown notes.
// Usage: node build-release-payload.cjs <version> <notes-file> <out-file>
const fs = require("fs");
const [, , version, notesFile, outFile] = process.argv;
if (!version || !notesFile || !outFile) {
	console.error("usage: build-release-payload.cjs <version> <notes-file> <out-file>");
	process.exit(1);
}
const body = fs.readFileSync(notesFile, "utf8").replace(/\r\n/g, "\n");
const payload = {
	tag_name: `v${version}`,
	name: `Meridian v${version}`,
	body,
};
fs.writeFileSync(outFile, JSON.stringify(payload), "utf8");