// Map a filename to a Prism/markdown code-fence language tag. Used by the
// attachment preview modal so CodeBlock can syntax-highlight the content.
// Returns "" when the extension is unknown -- MarkdownRenderer's CodeBlock
// renders that as plain "code" with no highlighting.
export function languageFromName(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	switch (ext) {
		case "ts": return "typescript";
		case "tsx": return "tsx";
		case "js": return "javascript";
		case "jsx": return "jsx";
		case "mjs": case "cjs": return "javascript";
		case "py": return "python";
		case "rs": return "rust";
		case "go": return "go";
		case "rb": return "ruby";
		case "java": return "java";
		case "kt": case "kts": return "kotlin";
		case "swift": return "swift";
		case "c": case "h": return "c";
		case "cpp": case "cc": case "cxx": case "hpp": return "cpp";
		case "cs": return "csharp";
		case "php": return "php";
		case "sh": case "bash": case "zsh": return "bash";
		case "ps1": return "powershell";
		case "sql": return "sql";
		case "json": return "json";
		case "yaml": case "yml": return "yaml";
		case "toml": return "toml";
		case "xml": return "xml";
		case "html": case "htm": return "html";
		case "css": return "css";
		case "scss": case "sass": return "scss";
		case "md": case "markdown": return "markdown";
		case "dockerfile": return "dockerfile";
		case "makefile": case "mk": return "makefile";
		case "lua": return "lua";
		case "vim": return "vim";
		case "r": return "r";
		case "dart": return "dart";
		case "ex": case "exs": return "elixir";
		case "elm": return "elm";
		case "clj": case "cljs": return "clojure";
		case "scala": return "scala";
		case "hs": return "haskell";
		case "csv": case "tsv": return "";
		case "log": case "txt": return "";
		default: {
			// Special filenames with no extension
			const base = name.toLowerCase();
			if (base === "dockerfile" || base.endsWith(".dockerfile")) return "dockerfile";
			if (base === "makefile") return "makefile";
			return "";
		}
	}
}