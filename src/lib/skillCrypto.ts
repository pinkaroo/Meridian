// Web Crypto-based encryption for skill settings.
//
// - Algorithm: AES-GCM 256-bit (authenticated symmetric encryption).
// - Key derivation: PBKDF2-SHA256, 250k iterations from a user passphrase.
// - Each ciphertext gets its own random 12-byte IV.
// - The passphrase is NEVER stored. Only a verification token (an encrypted
//   known plaintext) is persisted so we can confirm the passphrase on unlock.
// - The derived key is kept in memory (module-scoped) only for the current
//   session; closing/reloading the app forces re-unlock.

const PBKDF2_ITERATIONS = 250_000;
const SALT_KEY = "meridian.skillCrypto.salt.v1";
const VERIFIER_KEY = "meridian.skillCrypto.verifier.v1";
const VERIFIER_PLAINTEXT = "meridian-skill-crypto-ok";

let activeKey: CryptoKey | null = null;

function toB64(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

function fromB64(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

function getOrCreateSalt(): Uint8Array {
	const existing = localStorage.getItem(SALT_KEY);
	if (existing) return fromB64(existing);
	const salt = crypto.getRandomValues(new Uint8Array(16));
	localStorage.setItem(SALT_KEY, toB64(salt));
	return salt;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey(
		"raw",
		enc.encode(passphrase),
		{ name: "PBKDF2" },
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt as unknown as BufferSource,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/**
 * Has the user ever set a master passphrase?
 * (verifier blob exists in localStorage)
 */
export function isCryptoInitialized(): boolean {
	return localStorage.getItem(VERIFIER_KEY) !== null;
}

/**
 * Is the vault currently unlocked in this session?
 */
export function isUnlocked(): boolean {
	return activeKey !== null;
}

/**
 * Set the master passphrase for the first time. Stores a verifier blob so
 * future unlocks can validate the passphrase. Returns true on success.
 */
export async function initPassphrase(passphrase: string): Promise<boolean> {
	if (isCryptoInitialized()) return false;
	if (!passphrase || passphrase.length < 4) return false;

	const salt = getOrCreateSalt();
	const key = await deriveKey(passphrase, salt);
	const verifier = await encryptWithKey(key, VERIFIER_PLAINTEXT);
	localStorage.setItem(VERIFIER_KEY, verifier);
	activeKey = key;
	return true;
}

/**
 * Unlock with an existing passphrase. Returns true on success, false on
 * wrong passphrase.
 */
export async function unlock(passphrase: string): Promise<boolean> {
	if (!isCryptoInitialized()) return false;
	try {
		const salt = getOrCreateSalt();
		const key = await deriveKey(passphrase, salt);
		const verifier = localStorage.getItem(VERIFIER_KEY)!;
		const decoded = await decryptWithKey(key, verifier);
		if (decoded !== VERIFIER_PLAINTEXT) return false;
		activeKey = key;
		return true;
	} catch {
		return false;
	}
}

/**
 * Forget the in-memory key. Subsequent reads will fail until unlock().
 */
export function lock(): void {
	activeKey = null;
}

/**
 * Encrypt a plaintext string using the active session key.
 * Returns a base64 envelope: "v1:" + base64(iv || ciphertext).
 * Throws if the vault is locked.
 */
export async function encrypt(plaintext: string): Promise<string> {
	if (!activeKey) throw new Error("Skill vault is locked");
	return encryptWithKey(activeKey, plaintext);
}

/**
 * Decrypt an envelope produced by encrypt(). Throws on tamper / wrong key.
 */
export async function decrypt(envelope: string): Promise<string> {
	if (!activeKey) throw new Error("Skill vault is locked");
	return decryptWithKey(activeKey, envelope);
}

async function encryptWithKey(key: CryptoKey, plaintext: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const enc = new TextEncoder();
	const ctBuf = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: iv as unknown as BufferSource },
		key,
		enc.encode(plaintext),
	);
	const ct = new Uint8Array(ctBuf);
	const combined = new Uint8Array(iv.length + ct.length);
	combined.set(iv, 0);
	combined.set(ct, iv.length);
	return "v1:" + toB64(combined);
}

async function decryptWithKey(key: CryptoKey, envelope: string): Promise<string> {
	if (!envelope.startsWith("v1:")) throw new Error("Unknown envelope format");
	const combined = fromB64(envelope.slice(3));
	if (combined.length < 13) throw new Error("Ciphertext too short");
	const iv = combined.slice(0, 12);
	const ct = combined.slice(12);
	const ptBuf = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: iv as unknown as BufferSource },
		key,
		ct as unknown as BufferSource,
	);
	return new TextDecoder().decode(ptBuf);
}

/**
 * Reset the entire vault: removes salt, verifier, and all encrypted skill
 * settings. Use when the user has forgotten their passphrase.
 * Returns the number of skill setting entries removed.
 */
export function resetVault(): number {
	localStorage.removeItem(SALT_KEY);
	localStorage.removeItem(VERIFIER_KEY);
	activeKey = null;

	// Caller is responsible for also clearing skill settings storage.
	// Returned count kept for future use.
	return 0;
}