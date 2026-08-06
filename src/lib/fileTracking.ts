// Track file state at read time so writes can detect external changes.
// Module-level Map keyed by `${baseDir}|${path}`. Records the content length
// captured at the moment the agent last read the file. On any write-class op,
// the dispatcher compares current state to the recorded state and surfaces a
// warning to the model if the file changed since last read -- catching the
// "model read at turn 1, edits at turn 5, file changed externally" failure
// mode that would otherwise produce silent corruption.

interface FileSnapshot {
	contentLen: number;
	readAt: number;
}

const FILE_STATE = new Map<string, FileSnapshot>();
const MAX_TRACKED = 500;

function keyFor(path: string, baseDir: string | undefined): string {
	return `${baseDir || ""}|${path}`;
}

export function recordFileRead(path: string, baseDir: string | undefined, content: string): void {
	if (!path) return;
	const key = keyFor(path, baseDir);
	FILE_STATE.set(key, { contentLen: content.length, readAt: Date.now() });
	// LRU-ish cap: drop oldest insertion when over limit.
	if (FILE_STATE.size > MAX_TRACKED) {
		const firstKey = FILE_STATE.keys().next().value;
		if (firstKey !== undefined) FILE_STATE.delete(firstKey);
	}
}

export function checkFileChanged(
	path: string,
	baseDir: string | undefined,
	currentContent: string,
): { changed: boolean; lastReadAt: number | null } {
	if (!path) return { changed: false, lastReadAt: null };
	const key = keyFor(path, baseDir);
	const snap = FILE_STATE.get(key);
	if (!snap) return { changed: false, lastReadAt: null };
	return {
		changed: snap.contentLen !== currentContent.length,
		lastReadAt: snap.readAt,
	};
}

export function clearFileTracking(): void {
	FILE_STATE.clear();
}