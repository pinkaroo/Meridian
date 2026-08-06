
const THUMB_SIZE = 96;
const MAX_DIM = 1568;
const JPEG_QUALITY = 0.9;

export const IMAGE_MIME_RX = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
export const IMAGE_EXT_RX = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function isImageFile(file: File): boolean {
	if (file.type && IMAGE_MIME_RX.test(file.type)) return true;
	return IMAGE_EXT_RX.test(file.name);
}

export function isImageMime(mime: string, name?: string): boolean {
	if (mime && IMAGE_MIME_RX.test(mime)) return true;
	if (name && IMAGE_EXT_RX.test(name)) return true;
	return false;
}

export interface ProcessedImage {
	thumbDataUrl: string;
	fullDataUrl: string;
	mimeType: string;
}

export async function processImageFile(file: File): Promise<ProcessedImage> {
	const originalDataUrl = await fileToDataUrl(file);

	if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) {
		return {
			thumbDataUrl: originalDataUrl,
			fullDataUrl: originalDataUrl,
			mimeType: file.type || "image/svg+xml",
		};
	}

	const img = await loadImage(originalDataUrl);
	const thumbDataUrl = renderSquareThumbnail(img, THUMB_SIZE);
	const fullDataUrl = renderDownscaled(img, MAX_DIM, file.type || "image/jpeg") ?? originalDataUrl;
	return {
		thumbDataUrl,
		fullDataUrl,
		mimeType: file.type || guessImageMime(file.name),
	};
}

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("Failed to read image " + file.name));
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.readAsDataURL(file);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Failed to decode image"));
		img.src = src;
	});
}

function renderSquareThumbnail(img: HTMLImageElement, size: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) return "";
	const side = Math.min(img.naturalWidth, img.naturalHeight);
	const sx = (img.naturalWidth - side) / 2;
	const sy = (img.naturalHeight - side) / 2;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
	return canvas.toDataURL("image/jpeg", 0.85);
}

function renderDownscaled(img: HTMLImageElement, maxDim: number, mime: string): string | null {
	const w = img.naturalWidth;
	const h = img.naturalHeight;
	if (w <= maxDim && h <= maxDim) return null;
	const scale = Math.min(maxDim / w, maxDim / h);
	const dw = Math.round(w * scale);
	const dh = Math.round(h * scale);
	const canvas = document.createElement("canvas");
	canvas.width = dw;
	canvas.height = dh;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, 0, 0, dw, dh);
	const outMime = /png/i.test(mime) ? "image/png" : "image/jpeg";
	return outMime === "image/png"
		? canvas.toDataURL("image/png")
		: canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function guessImageMime(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "png") return "image/png";
	if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
	if (ext === "gif") return "image/gif";
	if (ext === "webp") return "image/webp";
	if (ext === "bmp") return "image/bmp";
	if (ext === "svg") return "image/svg+xml";
	return "image/jpeg";
}
