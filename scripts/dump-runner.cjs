const fs = require('fs');
const path = require('path');
const file = path.resolve('src/lib/agentRunner.ts');
const buf = fs.readFileSync(file);
const b64 = buf.toString('base64');
const outDir = path.resolve('scripts/tmp');
fs.mkdirSync(outDir, { recursive: true });
// Split into 4KB base64 chunks so each one fits comfortably in a tool result
const CHUNK = 4000;
let i = 0, n = 0;
while (i < b64.length) {
  fs.writeFileSync(path.join(outDir, `runner.${String(n).padStart(3,'0')}.b64`), b64.slice(i, i + CHUNK));
  i += CHUNK;
  n++;
}
console.log(`bytes=${buf.length} chunks=${n}`);