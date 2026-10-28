// Client-side meme renderer: pure helpers (size, wrapping, fitting) plus the canvas drawing.

export const CAPTION_MAX = 100;
export const OUTPUT_MAX_SIDE = 1200;
export const MAX_LINES = 3;
export const FONT_FAMILY = "Anton, Impact, 'Arial Narrow Bold', sans-serif";

const MAX_FONT_RATIO = 0.1;
const MIN_FONT_RATIO = 0.04;
const FONT_STEP = 2;
const EDGE_RATIO = 0.03;
const LINE_HEIGHT = 1.1;
const TEXT_WIDTH_RATIO = 0.92;
const ELLIPSIS = '…';

/** Output size: longest side capped at OUTPUT_MAX_SIDE, aspect preserved, integers, at least 1. */
export function outputSize(w: number, h: number): { width: number; height: number } {
	const longest = Math.max(w, h);
	const scale = longest > OUTPUT_MAX_SIDE ? OUTPUT_MAX_SIDE / longest : 1;
	return {
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale))
	};
}

/** Shortens a word with a trailing ellipsis until it fits (binary search, deterministic). */
function shortenWord(measure: (text: string) => number, word: string, maxWidth: number): string {
	let low = 0;
	let high = word.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (measure(word.slice(0, mid) + ELLIPSIS) <= maxWidth) low = mid;
		else high = mid - 1;
	}
	return word.slice(0, low) + ELLIPSIS;
}

/** Greedy word wrap at spaces. A single word wider than maxWidth is cut with an ellipsis. */
export function wrapCaption(
	measure: (text: string) => number,
	text: string,
	maxWidth: number
): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = '';
	for (let word of words) {
		if (measure(word) > maxWidth) word = shortenWord(measure, word, maxWidth);
		const candidate = current ? `${current} ${word}` : word;
		if (!current || measure(candidate) <= maxWidth) {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/** Largest font size (10 % down to 4 % of the height, 2 px steps) whose wrap needs at most 3 lines. */
export function fitCaption(
	measureAt: (fontSize: number, text: string) => number,
	text: string,
	maxWidth: number,
	canvasHeight: number
): { fontSize: number; lines: string[] } {
	const max = Math.max(1, Math.round(MAX_FONT_RATIO * canvasHeight));
	const min = Math.min(max, Math.max(1, Math.round(MIN_FONT_RATIO * canvasHeight)));
	let fontSize = max;
	for (; fontSize >= min; fontSize -= FONT_STEP) {
		const lines = wrapCaption((t) => measureAt(fontSize, t), text, maxWidth);
		if (lines.length <= MAX_LINES) return { fontSize, lines };
	}
	// Nothing fit: stay at the smallest size tried and cut the overflow.
	fontSize += FONT_STEP;
	const measure = (t: string) => measureAt(fontSize, t);
	const lines = wrapCaption(measure, text, maxWidth);
	const kept = lines.slice(0, MAX_LINES);
	if (lines.length > MAX_LINES) {
		const last = kept[MAX_LINES - 1];
		if (!last.endsWith(ELLIPSIS)) {
			kept[MAX_LINES - 1] =
				measure(last + ELLIPSIS) <= maxWidth
					? last + ELLIPSIS
					: shortenWord(measure, last, maxWidth);
		}
	}
	return { fontSize, lines: kept };
}

/** Draws the image scaled to the output size, then the top and bottom captions. */
export function drawMeme(
	canvas: HTMLCanvasElement,
	image: CanvasImageSource & { width: number; height: number },
	opts: { top: string; bottom: string; uppercase: boolean; font?: string }
): void {
	const { width, height } = outputSize(image.width, image.height);
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not render the meme.');
	ctx.drawImage(image, 0, 0, width, height);

	const family = opts.font ?? FONT_FAMILY;
	const maxWidth = TEXT_WIDTH_RATIO * width;
	const edge = EDGE_RATIO * height;

	const measureAt = (fontSize: number, text: string) => {
		ctx.font = `${fontSize}px ${family}`;
		return ctx.measureText(text).width;
	};

	const drawCaption = (raw: string, position: 'top' | 'bottom') => {
		const text = opts.uppercase ? raw.toUpperCase() : raw;
		const { fontSize, lines } = fitCaption(measureAt, text, maxWidth, height);
		if (lines.length === 0) return;
		ctx.font = `${fontSize}px ${family}`;
		ctx.textAlign = 'center';
		ctx.fillStyle = '#fff';
		ctx.strokeStyle = '#000';
		ctx.lineWidth = fontSize / 10;
		ctx.lineJoin = 'round';
		ctx.textBaseline = position;
		const x = width / 2;
		lines.forEach((line, i) => {
			const y =
				position === 'top'
					? edge + i * fontSize * LINE_HEIGHT
					: height - edge - (lines.length - 1 - i) * fontSize * LINE_HEIGHT;
			ctx.strokeText(line, x, y);
			ctx.fillText(line, x, y);
		});
	};

	drawCaption(opts.top, 'top');
	drawCaption(opts.bottom, 'bottom');
}

/** Promise wrapper around canvas.toBlob, always PNG. */
export function renderBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('Could not render the meme.'));
		}, 'image/png');
	});
}
