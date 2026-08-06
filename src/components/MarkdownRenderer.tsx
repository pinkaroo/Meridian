import { memo, useState } from "react";
	import ReactMarkdown from "react-markdown";
	import remarkGfm from "remark-gfm";
	import { Dialog, DialogContent } from "@/components/ui/dialog";
	import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
	import { cn } from "@/lib/utils";
	import { useLightbox } from "./ImageLightbox";
	import {
		ListOrdered, WrapText, Maximize2, Minimize2, Copy, Check,
	} from "lucide-react";

	function CodeBlock({ language, code }: { language: string; code: string }) {
		const [copied, setCopied] = useState(false);
		const [wordWrap, setWordWrap] = useState(true);
		const [showLines, setShowLines] = useState(false);
		const [fullscreen, setFullscreen] = useState(false);

		function copy() {
			navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}

		const block = (
			<div className="code-block">
				<div className="code-block-header">
					<span className="code-lang">{language || "code"}</span>
					<TooltipProvider delayDuration={300}>
						<div className="flex items-center gap-0.5">
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => setShowLines(v => !v)}
										className={cn(
											"rounded p-1 transition-colors hover:bg-accent",
											showLines && "text-primary",
										)}
									>
										<ListOrdered className="h-3 w-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Toggle line numbers</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => setWordWrap(v => !v)}
										className={cn(
											"rounded p-1 transition-colors hover:bg-accent",
											wordWrap && "text-primary",
										)}
									>
										<WrapText className="h-3 w-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Toggle word wrap</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => setFullscreen(v => !v)}
										className="rounded p-1 transition-colors hover:bg-accent"
									>
										{fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
									</button>
								</TooltipTrigger>
								<TooltipContent>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={copy}
										className={cn(
											"rounded p-1 transition-colors hover:bg-accent",
											copied && "text-emerald-500",
										)}
									>
										{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
									</button>
								</TooltipTrigger>
								<TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
							</Tooltip>
						</div>
					</TooltipProvider>
				</div>
				<pre className={`code-native ${wordWrap ? "wrap" : ""} ${showLines ? "with-lines" : ""}`}>
					<code>
						{showLines
							? code.split("\n").map((line, idx) => (
								<span className="code-line" key={`${idx}-${line}`}>
									<span className="code-line-num">{idx + 1}</span>
									<span className="code-line-text">{line || " "}</span>
								</span>
							))
							: code}
					</code>
				</pre>
			</div>
		);

		return (
			<>
				{!fullscreen && block}
				<Dialog open={fullscreen} onOpenChange={setFullscreen}>
					<DialogContent className="h-screen max-h-screen w-screen max-w-none rounded-none border-0 p-4">
						<div className="mx-auto w-full max-w-[1200px]">{block}</div>
					</DialogContent>
				</Dialog>
			</>
		);
	}

	const MD_COMPONENTS = {
		code({ className, children, ...props }: any) {
			const match = /language-(\w+)/.exec(className || "");
			if (match) {
				return <CodeBlock language={match[1]} code={String(children).replace(/\n$/, "")} />;
			}
			return <code className="inline-code" {...props}>{children}</code>;
		},
		a({ href, children }: any) {
			return <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">{children}</a>;
		},
		table({ children }: any) {
			return <div className="md-table-wrap"><table>{children}</table></div>;
		},
		blockquote({ children }: any) {
			return <blockquote className="md-blockquote">{children}</blockquote>;
		},
		input({ checked, ...props }: any) {
			return <input type="checkbox" checked={checked} readOnly className="md-task-checkbox" {...props} />;
		},
		img({ src, alt }: any) {
			return <MarkdownImage src={src} alt={alt} />;
		},
	};

	function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
		const lightbox = useLightbox();
		if (!src) return null;
		return (
			<img
				src={src}
				alt={alt || ""}
				onClick={() => lightbox.openSingle(src, alt, alt)}
				className="md-img image-reveal cursor-zoom-in rounded-md transition-transform hover:scale-[1.01]"
			/>
		);
	}

	const MD_PLUGINS = [remarkGfm];

	function MarkdownRendererImpl({ content }: { content: string }) {
		return (
			<div className="markdown-body">
				<ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>
					{content}
				</ReactMarkdown>
			</div>
		);
	}

	const MarkdownRenderer = memo(MarkdownRendererImpl, (prev, next) => prev.content === next.content);
	export default MarkdownRenderer;
