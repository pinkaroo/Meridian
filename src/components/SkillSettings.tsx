import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, EyeOff, Lock, Settings2, ShieldCheck, Trash2, KeyRound, AlertTriangle, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadSkills, resolveSkillRoots, type SkillEntry } from "../lib/skills";
import {
	loadSkillSchema,
	getDecryptedSkillSettings,
	saveSkillSettings,
	setRawSkillSettings,
	listConfiguredSkills,
	wipeAllSkillSettings,
	type SkillSettingsSchema,
	type SkillSettingField,
} from "../lib/skillSettings";
import {
	isCryptoInitialized,
	isUnlocked,
	initPassphrase,
	unlock,
	lock,
	resetVault,
} from "../lib/skillCrypto";
import type { AppSettings } from "../types";

interface Props {
	settings: AppSettings;
}

interface SkillRow {
	entry: SkillEntry;
	schema: SkillSettingsSchema | null;
}

type VaultState = "none" | "locked" | "unlocked";

export default function SkillSettings({ settings }: Props) {
	const [loading, setLoading] = useState(true);
	const [rows, setRows] = useState<SkillRow[]>([]);
	const [configured, setConfigured] = useState<Set<string>>(new Set(listConfiguredSkills()));
	const [vaultState, setVaultState] = useState<VaultState>(() =>
		!isCryptoInitialized() ? "none" : isUnlocked() ? "unlocked" : "locked",
	);
	const [editing, setEditing] = useState<SkillRow | null>(null);
	const [showVaultModal, setShowVaultModal] = useState(false);
	const [showResetConfirm, setShowResetConfirm] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			const roots = resolveSkillRoots(settings.workdir, settings.skillsGlobalRoot);
			const skills = roots.length ? await loadSkills(roots) : [];
			const withSchemas: SkillRow[] = await Promise.all(
				skills.map(async (entry) => ({
					entry,
					schema: await loadSkillSchema(entry.relPath),
				})),
			);
			if (!cancelled) {
				setRows(withSchemas);
				setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [settings.workdir, settings.skillsGlobalRoot]);

	function refreshConfigured() {
		setConfigured(new Set(listConfiguredSkills()));
	}

	function refreshVaultState() {
		setVaultState(!isCryptoInitialized() ? "none" : isUnlocked() ? "unlocked" : "locked");
	}

	function handleLock() {
		lock();
		refreshVaultState();
	}

	function handleReset() {
		resetVault();
		wipeAllSkillSettings();
		setShowResetConfirm(false);
		refreshConfigured();
		refreshVaultState();
	}

	const configurable = rows.filter(r => r.schema && r.schema.fields.length > 0);
	const nonConfigurable = rows.filter(r => !r.schema || r.schema.fields.length === 0);

	return (
		<div>
			<div className="mb-3 mt-0 text-xs font-bold uppercase tracking-wide text-primary">Skill Vault</div>
			<div className="rounded-md border border-border bg-muted/30 p-3">
				<div className="flex items-start gap-3">
					<div className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
						vaultState === "unlocked" ? "bg-emerald-500/15 text-emerald-500" :
						vaultState === "locked" ? "bg-amber-500/15 text-amber-500" :
						"bg-muted text-muted-foreground",
					)}>
						{vaultState === "unlocked" ? <Unlock className="h-4 w-4" /> :
						 vaultState === "locked" ? <Lock className="h-4 w-4" /> :
						 <ShieldCheck className="h-4 w-4" />}
					</div>
					<div className="min-w-0 flex-1">
						<div className="text-sm font-semibold">
							{vaultState === "unlocked" && "Vault unlocked"}
							{vaultState === "locked" && "Vault locked"}
							{vaultState === "none" && "No vault set"}
						</div>
						<div className="mt-0.5 text-xs leading-snug text-muted-foreground">
							{vaultState === "unlocked" && "Secret fields can be read and written this session. Lock when you step away."}
							{vaultState === "locked" && "Enter your master passphrase to view or edit secret fields."}
							{vaultState === "none" && "Set a master passphrase to enable encrypted storage for tokens and API keys. AES-GCM 256 with PBKDF2 key derivation."}
						</div>
					</div>
					<div className="flex shrink-0 gap-1.5">
						{vaultState === "unlocked" && (
							<Button size="sm" variant="outline" onClick={handleLock} className="gap-1.5">
								<Lock className="h-3.5 w-3.5" />Lock
							</Button>
						)}
						{vaultState !== "unlocked" && (
							<Button size="sm" onClick={() => setShowVaultModal(true)} className="gap-1.5">
								<KeyRound className="h-3.5 w-3.5" />
								{vaultState === "none" ? "Set passphrase" : "Unlock"}
							</Button>
						)}
						{vaultState !== "none" && (
							<Button size="sm" variant="ghost" onClick={() => setShowResetConfirm(true)} title="Reset vault" className="text-destructive hover:text-destructive">
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-primary">Configurable Skills</div>
			<p className="mb-2 text-xs text-muted-foreground">
				Skills that ship a <code className="rounded bg-muted px-1 py-0.5 text-[0.65rem]">settings.json</code> schema. Secret fields are encrypted with the vault passphrase.
			</p>

			{loading && <div className="py-4 text-center text-xs text-muted-foreground">Loading skills…</div>}

			{!loading && configurable.length === 0 && (
				<div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
					No skills with configurable settings found.
				</div>
			)}

			<div className="flex flex-col gap-1.5">
				{configurable.map(row => (
					<button
						key={row.entry.name}
						type="button"
						onClick={() => setEditing(row)}
						className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50"
					>
						<Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span className="text-sm font-semibold">{row.entry.name}</span>
								{configured.has(row.entry.name) && (
									<Badge variant="outline" className="h-5 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[0.6rem] text-emerald-500">
										Configured
									</Badge>
								)}
								{row.schema!.fields.some(f => f.secret) && (
									<Badge variant="outline" className="h-5 px-1.5 text-[0.6rem]">
										<Lock className="mr-1 h-2.5 w-2.5" />Has secrets
									</Badge>
								)}
							</div>
							<div className="mt-0.5 truncate text-xs text-muted-foreground">
								{row.schema!.fields.length} field{row.schema!.fields.length === 1 ? "" : "s"} · {row.schema!.fields.map(f => f.label).join(", ")}
							</div>
						</div>
						<span className="text-xs text-muted-foreground">Configure →</span>
					</button>
				))}
			</div>

			{!loading && nonConfigurable.length > 0 && (
				<>
					<div className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-muted-foreground">Other Skills</div>
					<p className="mb-2 text-xs text-muted-foreground">These skills don't expose any configurable settings.</p>
					<div className="flex flex-wrap gap-1.5">
						{nonConfigurable.map(row => (
							<Badge key={row.entry.name} variant="outline" className="opacity-60">{row.entry.name}</Badge>
						))}
					</div>
				</>
			)}

			{showVaultModal && (
				<VaultModal
					mode={vaultState === "none" ? "init" : "unlock"}
					onClose={() => setShowVaultModal(false)}
					onSuccess={() => { setShowVaultModal(false); refreshVaultState(); }}
				/>
			)}

			{showResetConfirm && (
				<Dialog open onOpenChange={(o) => !o && setShowResetConfirm(false)}>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<AlertTriangle className="h-5 w-5 text-destructive" />
								Reset vault?
							</DialogTitle>
						</DialogHeader>
						<p className="text-sm text-muted-foreground">
							This permanently deletes your passphrase and <strong>all encrypted skill settings</strong>. Non-secret settings will also be cleared. This cannot be undone.
						</p>
						<DialogFooter>
							<Button variant="outline" onClick={() => setShowResetConfirm(false)}>Cancel</Button>
							<Button variant="destructive" onClick={handleReset}>Reset vault</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}

			{editing && (
				<SkillEditor
					row={editing}
					vaultState={vaultState}
					onUnlockNeeded={() => setShowVaultModal(true)}
					onClose={() => setEditing(null)}
					onSaved={() => { refreshConfigured(); setEditing(null); }}
				/>
			)}
		</div>
	);
}

function VaultModal({ mode, onClose, onSuccess }: { mode: "init" | "unlock"; onClose: () => void; onSuccess: () => void }) {
	const [pass, setPass] = useState("");
	const [confirm, setConfirm] = useState("");
	const [show, setShow] = useState(false);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	async function submit() {
		setErr(null);
		if (mode === "init") {
			if (pass.length < 8) { setErr("Passphrase must be at least 8 characters."); return; }
			if (pass !== confirm) { setErr("Passphrases don't match."); return; }
			setBusy(true);
			const ok = await initPassphrase(pass);
			setBusy(false);
			if (!ok) { setErr("Failed to initialize vault."); return; }
			onSuccess();
		} else {
			if (!pass) { setErr("Enter your passphrase."); return; }
			setBusy(true);
			const ok = await unlock(pass);
			setBusy(false);
			if (!ok) { setErr("Wrong passphrase."); return; }
			onSuccess();
		}
	}

	return (
		<Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{mode === "init" ? "Set master passphrase" : "Unlock skill vault"}</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					{mode === "init" && (
						<p className="text-xs text-muted-foreground">
							This passphrase protects secret fields stored in skill settings. It is never sent anywhere and never stored — only a verification token is kept locally. <strong>If you forget it, you'll need to reset the vault and re-enter all secrets.</strong>
						</p>
					)}
					<div>
						<Label className="mb-1.5 block text-xs">Passphrase</Label>
						<div className="relative">
							<Input
								type={show ? "text" : "password"}
								value={pass}
								onChange={e => setPass(e.target.value)}
								autoFocus
								disabled={busy}
								onKeyDown={e => { if (e.key === "Enter") submit(); }}
								className="pr-9"
							/>
							<button
								type="button"
								onClick={() => setShow(s => !s)}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								tabIndex={-1}
							>
								{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
							</button>
						</div>
					</div>
					{mode === "init" && (
						<div>
							<Label className="mb-1.5 block text-xs">Confirm passphrase</Label>
							<Input
								type={show ? "text" : "password"}
								value={confirm}
								onChange={e => setConfirm(e.target.value)}
								disabled={busy}
								onKeyDown={e => { if (e.key === "Enter") submit(); }}
							/>
						</div>
					)}
					{err && <p className="text-xs text-destructive">{err}</p>}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={submit} disabled={busy}>
						{busy ? "Working…" : mode === "init" ? "Set passphrase" : "Unlock"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SkillEditor({ row, vaultState, onUnlockNeeded, onClose, onSaved }: {
	row: SkillRow;
	vaultState: VaultState;
	onUnlockNeeded: () => void;
	onClose: () => void;
	onSaved: () => void;
}) {
	const schema = row.schema!;
	const hasSecrets = schema.fields.some(f => f.secret);
	const [values, setValues] = useState<Record<string, string | number | boolean | null>>({});
	const [reveal, setReveal] = useState<Record<string, boolean>>({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const decrypted = await getDecryptedSkillSettings(row.entry.name, schema);
			if (!cancelled) {
				setValues(decrypted);
				setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [row.entry.name, schema, vaultState]);

	async function save() {
		setErr(null);
		setSaving(true);
		try {
			await saveSkillSettings(row.entry.name, schema, values);
			onSaved();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	}

	function clearAll() {
		setRawSkillSettings(row.entry.name, {});
		onSaved();
	}

	const needsUnlock = hasSecrets && vaultState !== "unlocked";

	return (
		<Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{row.entry.name}</DialogTitle>
				</DialogHeader>

				{loading && <div className="py-4 text-center text-xs text-muted-foreground">Loading…</div>}

				{!loading && needsUnlock && (
					<div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
						<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
							<Lock className="h-4 w-4" />Vault locked
						</div>
						<p className="mb-3 text-xs text-muted-foreground">
							This skill has secret fields. Unlock the vault to view or edit them.
						</p>
						<Button size="sm" onClick={onUnlockNeeded}>Unlock vault</Button>
					</div>
				)}

				{!loading && !needsUnlock && (
					<div className="flex flex-col gap-4">
						{schema.fields.map(field => (
							<FieldEditor
								key={field.key}
								field={field}
								value={values[field.key] ?? ""}
								onChange={(v) => setValues(prev => ({ ...prev, [field.key]: v }))}
								revealed={!!reveal[field.key]}
								onToggleReveal={() => setReveal(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
							/>
						))}
						{err && <p className="text-xs text-destructive">{err}</p>}
					</div>
				)}

				<DialogFooter className="flex-row items-center justify-between sm:justify-between">
					<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={clearAll} disabled={saving}>
						Clear all
					</Button>
					<div className="flex gap-2">
						<Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
						<Button onClick={save} disabled={saving || loading || needsUnlock}>
							{saving ? "Saving…" : "Save"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FieldEditor({ field, value, onChange, revealed, onToggleReveal }: {
	field: SkillSettingField;
	value: string | number | boolean | null;
	onChange: (v: string | number | boolean) => void;
	revealed: boolean;
	onToggleReveal: () => void;
}) {
	const v = value ?? "";

	if (field.type === "boolean") {
		return (
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<Label className="text-sm font-semibold">{field.label}</Label>
					{field.description && <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>}
				</div>
				<Switch checked={!!v} onCheckedChange={onChange} />
			</div>
		);
	}

	if (field.type === "select" && field.options) {
		return (
			<div>
				<Label className="mb-1.5 block text-sm font-semibold">{field.label}</Label>
				{field.description && <p className="mb-1.5 text-xs text-muted-foreground">{field.description}</p>}
				<Select value={String(v)} onValueChange={onChange}>
					<SelectTrigger><SelectValue /></SelectTrigger>
					<SelectContent>
						{field.options.map(opt => (
							<SelectItem key={opt} value={opt}>{opt}</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		);
	}

	const isSecret = field.secret || field.type === "password";
	const inputType = isSecret && !revealed ? "password" : field.type === "number" ? "number" : "text";

	return (
		<div>
			<Label className="mb-1.5 block text-sm font-semibold">
				{field.label}
				{isSecret && <Lock className="ml-1.5 inline h-3 w-3 text-muted-foreground" />}
			</Label>
			{field.description && <p className="mb-1.5 text-xs text-muted-foreground">{field.description}</p>}
			<div className="relative">
				<Input
					type={inputType}
					value={String(v)}
					onChange={e => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
					placeholder={field.placeholder}
					className={isSecret ? "pr-9 font-mono" : ""}
				/>
				{isSecret && (
					<button
						type="button"
						onClick={onToggleReveal}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						tabIndex={-1}
						title={revealed ? "Hide" : "Show"}
					>
						{revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
					</button>
				)}
			</div>
		</div>
	);
}