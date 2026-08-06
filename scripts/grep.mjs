import fs from "node:fs";
const [, , file, ...patterns] = process.argv;
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
lines.forEach((l, i) => {
  for (const p of patterns) {
    if (l.includes(p)) { console.log(`${i + 1}: ${l.trim()}`); return; }
  }
});