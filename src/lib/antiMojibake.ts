

const CURLY_RSQUO = "\u2019";
const CURLY_LSQUO = "\u2018";
const CURLY_LDQUO = "\u201C";
const CURLY_RDQUO = "\u201D";
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";
const ELLIPSIS = "\u2026";
const NBSP = "\u00A0";

const MOJIBAKE_PAIRS: Array<[RegExp, string]> = [
	[new RegExp("\u00E2\u20AC\u2122", "g"), CURLY_RSQUO],
	[new RegExp("\u00E2\u20AC\u02DC", "g"), CURLY_LSQUO],
	[new RegExp("\u00E2\u20AC\u0153", "g"), CURLY_LDQUO],
	[new RegExp("\u00E2\u20AC\u009D", "g"), CURLY_RDQUO],
	[new RegExp("\u00E2\u20AC\u0094", "g"), EM_DASH],
	[new RegExp("\u00E2\u20AC\u0093", "g"), EN_DASH],
	[new RegExp("\u00E2\u20AC\u00A6", "g"), ELLIPSIS],
	[new RegExp("\u00C2\u00A0", "g"), NBSP],
];

export function repairMojibake(input: string): string {
	let out = input;
	for (const [rx, replacement] of MOJIBAKE_PAIRS) {
		if (rx.test(out)) out = out.replace(rx, replacement);
	}
	return out;
}

const ASCII_FOLD: Record<string, string> = {
	"\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'",
	"\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"',
	"\u2032": "'", "\u2033": '"',
	"\u00AB": '"', "\u00BB": '"',
	"\u2010": "-", "\u2011": "-", "\u2012": "-",
	"\u2212": "-",
	"\u00A0": " ",
	"\u2002": " ", "\u2003": " ", "\u2004": " ", "\u2005": " ",
	"\u2006": " ", "\u2007": " ", "\u2008": " ", "\u2009": " ",
	"\u200A": " ", "\u202F": " ", "\u205F": " ", "\u3000": " ",
	"\u200B": "", "\u200C": "", "\u200D": "", "\u2060": "", "\uFEFF": "",
	"\u2026": "...",
	"\u00B7": "*",
	"\u2022": "*", "\u2023": "*", "\u25E6": "*",
	"\u2190": "<-", "\u2192": "->", "\u2194": "<->",
	"\u21D0": "<=", "\u21D2": "=>", "\u21D4": "<=>",
	"\u00D7": "x", "\u00F7": "/",
	"\u2264": "<=", "\u2265": ">=", "\u2260": "!=",
	"\u00B1": "+/-",
	"\u00A9": "(c)", "\u00AE": "(R)", "\u2122": "(TM)",
};

const FOLD_RX = new RegExp(
	"[" +
		Object.keys(ASCII_FOLD)
			.map(c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
			.join("") +
		"]",
	"g",
);

export function asciiFold(input: string): string {
	return input.replace(FOLD_RX, ch => ASCII_FOLD[ch] ?? ch);
}

export interface SanitizeResult {
	content: string;
	repaired: boolean;
	folded: boolean;
	residualNonAscii: string[];
}

export function normalizeLineEndings(input: string): string {
	return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function sanitizeForWrite(input: string, opts?: { preserveExisting?: boolean }): SanitizeResult {
	const lfNormalized = normalizeLineEndings(input);
	const repaired = repairMojibake(lfNormalized);
	const wasRepaired = repaired !== lfNormalized;

	if (opts?.preserveExisting) {
		return {
			content: repaired,
			repaired: wasRepaired,
			folded: false,
			residualNonAscii: collectNonAscii(repaired),
		};
	}

	const folded = asciiFold(repaired);
	const wasFolded = folded !== repaired;
	return {
		content: folded,
		repaired: wasRepaired,
		folded: wasFolded,
		residualNonAscii: collectNonAscii(folded),
	};
}

function collectNonAscii(s: string): string[] {
	const seen = new Set<string>();
	for (const ch of s) {
		if (ch.charCodeAt(0) > 127) seen.add(ch);
	}
	return [...seen];
}

export function hasNonAscii(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		if (s.charCodeAt(i) > 127) return true;
	}
	return false;
}
