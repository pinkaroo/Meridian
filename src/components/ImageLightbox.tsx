import { useEffect, useState, useCallback, createContext, useContext, useMemo, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export type LightboxImage = {
	src: string;
	alt?: string;
	name?: string;
};

type LightboxContextValue = {
	open: (images: LightboxImage[], startIndex?: number) => void;
	openSingle: (src: string, alt?: string, name?: string) => void;
};

const LightboxContext = createContext<LightboxContextValue | null>(null);

export function useLightbox() {
	const ctx = useContext(LightboxContext);
	if (!ctx) {
		return {
			open: () => {},
			openSingle: () => {},
		};
	}
	return ctx;
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
	const [images, setImages] = useState<LightboxImage[]>([]);
	const [index, setIndex] = useState(0);
	const [isOpen, setIsOpen] = useState(false);

	const open = useCallback((imgs: LightboxImage[], startIndex = 0) => {
		if (imgs.length === 0) return;
		setImages(imgs);
		setIndex(Math.max(0, Math.min(startIndex, imgs.length - 1)));
		setIsOpen(true);
	}, []);

	const openSingle = useCallback((src: string, alt?: string, name?: string) => {
		open([{ src, alt, name }], 0);
	}, [open]);

	const close = useCallback(() => setIsOpen(false), []);
	const prev = useCallback(() => setIndex(i => (i - 1 + images.length) % images.length), [images.length]);
	const next = useCallback(() => setIndex(i => (i + 1) % images.length), [images.length]);

	const ctxValue = useMemo(() => ({ open, openSingle }), [open, openSingle]);

	return (
		<LightboxContext.Provider value={ctxValue}>
			{children}
			{isOpen && (
				<LightboxOverlay
					images={images}
					index={index}
					onClose={close}
					onPrev={prev}
					onNext={next}
				/>
			)}
		</LightboxContext.Provider>
	);
}

function LightboxOverlay({
	images,
	index,
	onClose,
	onPrev,
	onNext,
}: {
	images: LightboxImage[];
	index: number;
	onClose: () => void;
	onPrev: () => void;
	onNext: () => void;
}) {
	const current = images[index];
	const overlayRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") { e.preventDefault(); onClose(); }
			else if (e.key === "ArrowLeft" && images.length > 1) { e.preventDefault(); onPrev(); }
			else if (e.key === "ArrowRight" && images.length > 1) { e.preventDefault(); onNext(); }
		}
		window.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [onClose, onPrev, onNext, images.length]);

	function onBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
		if (e.target === overlayRef.current) onClose();
	}

	function download() {
		const a = document.createElement("a");
		a.href = current.src;
		a.download = current.name || "image";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	if (!current) return null;

	return (
		<div
			ref={overlayRef}
			onClick={onBackdropClick}
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
		>
			<button
				type="button"
				onClick={onClose}
				className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white/90 transition-colors hover:bg-white/20 hover:text-white"
				aria-label="Close"
			>
				<X className="h-5 w-5" />
			</button>
			<button
				type="button"
				onClick={download}
				className="absolute right-16 top-4 z-10 rounded-full bg-white/10 p-2 text-white/90 transition-colors hover:bg-white/20 hover:text-white"
				aria-label="Download"
			>
				<Download className="h-5 w-5" />
			</button>
			{images.length > 1 && (
				<>
					<button
						type="button"
						onClick={(e) => { e.stopPropagation(); onPrev(); }}
						className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/90 transition-colors hover:bg-white/20 hover:text-white"
						aria-label="Previous"
					>
						<ChevronLeft className="h-6 w-6" />
					</button>
					<button
						type="button"
						onClick={(e) => { e.stopPropagation(); onNext(); }}
						className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/90 transition-colors hover:bg-white/20 hover:text-white"
						aria-label="Next"
					>
						<ChevronRight className="h-6 w-6" />
					</button>
					<div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
						{index + 1} / {images.length}
					</div>
				</>
			)}
			<div
				className={cn(
					"relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-md shadow-2xl",
					"lightbox-checker",
				)}
				onClick={(e) => e.stopPropagation()}
			>
				<img
					src={current.src}
					alt={current.alt || current.name || "Image"}
					className="block max-h-[90vh] max-w-[90vw] object-contain"
				/>
			</div>
			{current.name && (
				<div className="absolute bottom-4 left-4 z-10 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90">
					{current.name}
				</div>
			)}
		</div>
	);
}
