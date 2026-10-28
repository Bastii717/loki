import { describe, expect, it } from 'vitest';
import {
	CAPTION_MAX,
	FONT_FAMILY,
	MAX_LINES,
	OUTPUT_MAX_SIDE,
	drawMeme,
	fitCaption,
	outputSize,
	renderBlob,
	wrapCaption
} from './meme-canvas';

const measureAt = (fontSize: number, text: string) => text.length * fontSize * 0.5;

describe('constants', () => {
	it('exposes the agreed limits', () => {
		expect(CAPTION_MAX).toBe(100);
		expect(OUTPUT_MAX_SIDE).toBe(1200);
		expect(MAX_LINES).toBe(3);
		expect(FONT_FAMILY).toBe("Anton, Impact, 'Arial Narrow Bold', sans-serif");
	});
});

describe('outputSize', () => {
	it('caps the longest side at 1200 and keeps the aspect', () => {
		expect(outputSize(4000, 3000)).toEqual({ width: 1200, height: 900 });
		expect(outputSize(1000, 2400)).toEqual({ width: 500, height: 1200 });
	});

	it('keeps small images as they are', () => {
		expect(outputSize(300, 300)).toEqual({ width: 300, height: 300 });
	});

	it('returns integers and at least 1', () => {
		const size = outputSize(3333, 1111);
		expect(Number.isInteger(size.width)).toBe(true);
		expect(Number.isInteger(size.height)).toBe(true);
		expect(outputSize(5000, 1)).toEqual({ width: 1200, height: 1 });
	});
});

describe('wrapCaption', () => {
	const measure = (text: string) => text.length * 10;

	it('keeps text that fits on one line', () => {
		expect(wrapCaption(measure, 'hello world', 200)).toEqual(['hello world']);
	});

	it('wraps at spaces into two lines', () => {
		expect(wrapCaption(measure, 'one two three four', 100)).toEqual(['one two', 'three four']);
	});

	it('wraps into three lines', () => {
		expect(wrapCaption(measure, 'aaaa bbbb cccc', 45)).toEqual(['aaaa', 'bbbb', 'cccc']);
	});

	it('collapses whitespace and returns nothing for empty text', () => {
		expect(wrapCaption(measure, '  a   b \n c ', 500)).toEqual(['a b c']);
		expect(wrapCaption(measure, '', 500)).toEqual([]);
		expect(wrapCaption(measure, '   ', 500)).toEqual([]);
	});

	it('shortens a single overlong word with an ellipsis', () => {
		const word = 'x'.repeat(100);
		const lines = wrapCaption(measure, word, 200);
		expect(lines).toHaveLength(1);
		expect(lines[0].endsWith('…')).toBe(true);
		expect(measure(lines[0])).toBeLessThanOrEqual(200);
		expect(lines[0].length).toBeGreaterThan(1);
	});

	it('shortens an overlong word between normal words', () => {
		const lines = wrapCaption(measure, `hi ${'y'.repeat(50)} yo`, 100);
		expect(lines.every((line) => measure(line) <= 100)).toBe(true);
		expect(lines.some((line) => line.endsWith('…'))).toBe(true);
	});
});

describe('fitCaption', () => {
	it('uses the largest size when the text fits', () => {
		const result = fitCaption(measureAt, 'short', 1000, 500);
		expect(result.fontSize).toBe(50);
		expect(result.lines).toEqual(['short']);
	});

	it('shrinks in steps of 2 px until at most three lines remain', () => {
		const text = 'this is a rather long caption that will need a smaller font size to fit';
		const result = fitCaption(measureAt, text, 400, 500);
		expect(result.lines.length).toBeLessThanOrEqual(MAX_LINES);
		expect(result.fontSize).toBeLessThan(50);
		expect(result.fontSize).toBeGreaterThanOrEqual(20);
		expect((50 - result.fontSize) % 2).toBe(0);
		// the next larger size would not have fit
		const larger = wrapCaption((t) => measureAt(result.fontSize + 2, t), text, 400);
		expect(larger.length).toBeGreaterThan(MAX_LINES);
	});

	it('never goes below 4 percent of the height and marks dropped text with an ellipsis', () => {
		const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
		const result = fitCaption(measureAt, text, 300, 500);
		expect(result.fontSize).toBe(20);
		expect(result.lines).toHaveLength(3);
		expect(result.lines[2].endsWith('…')).toBe(true);
		expect(result.lines[0].endsWith('…')).toBe(false);
	});

	it('returns no lines for empty text', () => {
		expect(fitCaption(measureAt, '', 300, 500).lines).toEqual([]);
	});
});

type Call = [string, ...unknown[]];

function stubCanvas() {
	const calls: Call[] = [];
	const ctx: Record<string, unknown> = {
		drawImage: (...args: unknown[]) => calls.push(['drawImage', ...args]),
		strokeText: (...args: unknown[]) =>
			calls.push(['strokeText', ...args, ctx.textBaseline, ctx.font, ctx.lineWidth]),
		fillText: (...args: unknown[]) => calls.push(['fillText', ...args, ctx.textBaseline]),
		measureText: (text: string) => {
			const size = Number.parseFloat(String(ctx.font));
			return { width: measureAt(size, text) };
		},
		font: '',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		lineJoin: '',
		textAlign: '',
		textBaseline: ''
	};
	const raw = { width: 0, height: 0, getContext: () => ctx };
	return { canvas: raw as unknown as HTMLCanvasElement, ctx, calls, raw };
}

const image = { width: 4000, height: 3000 } as CanvasImageSource & {
	width: number;
	height: number;
};

describe('drawMeme', () => {
	it('sizes the canvas and draws the image over the full output rect', () => {
		const { canvas, raw, calls } = stubCanvas();
		drawMeme(canvas, image, { top: '', bottom: '', uppercase: true });
		expect(raw.width).toBe(1200);
		expect(raw.height).toBe(900);
		expect(calls).toEqual([['drawImage', image, 0, 0, 1200, 900]]);
	});

	it('draws nothing for empty captions', () => {
		const { canvas, calls } = stubCanvas();
		drawMeme(canvas, image, { top: '  ', bottom: '', uppercase: false });
		expect(calls.map((c) => c[0])).toEqual(['drawImage']);
	});

	it('sets the classic text style', () => {
		const { canvas, ctx } = stubCanvas();
		drawMeme(canvas, image, { top: 'hi', bottom: '', uppercase: true });
		expect(ctx.textAlign).toBe('center');
		expect(ctx.fillStyle).toBe('#fff');
		expect(ctx.strokeStyle).toBe('#000');
		expect(ctx.lineJoin).toBe('round');
		expect(ctx.font).toBe(`90px ${FONT_FAMILY}`);
		expect(ctx.lineWidth).toBe(9);
	});

	it('uses a custom font and uppercases text', () => {
		const { canvas, calls } = stubCanvas();
		drawMeme(canvas, image, { top: 'hello', bottom: '', uppercase: true, font: 'Foo' });
		const stroke = calls.find((c) => c[0] === 'strokeText')!;
		expect(stroke[1]).toBe('HELLO');
		expect(stroke[5]).toBe('90px Foo');
	});

	it('keeps the case when uppercase is off', () => {
		const { canvas, calls } = stubCanvas();
		drawMeme(canvas, image, { top: 'Hello', bottom: '', uppercase: false });
		expect(calls.find((c) => c[0] === 'fillText')![1]).toBe('Hello');
	});

	it('puts the first top line at 3 percent and the last bottom line at 97 percent', () => {
		const { canvas, calls } = stubCanvas();
		drawMeme(canvas, image, { top: 'up', bottom: 'down', uppercase: false });
		const fills = calls.filter((c) => c[0] === 'fillText');
		expect(fills).toHaveLength(2);
		expect(fills[0]).toEqual(['fillText', 'up', 600, 0.03 * 900, 'top']);
		expect(fills[1]).toEqual(['fillText', 'down', 600, 900 - 0.03 * 900, 'bottom']);
	});

	it('strokes before filling and stacks lines by 1.1 times the font size', () => {
		const { canvas, calls } = stubCanvas();
		// 29 chars: too wide for one line at 90 px, fits in three lines at some smaller size
		const text = 'aaaaaaaaa bbbbbbbbb ccccccccc';
		drawMeme(canvas, image, { top: text, bottom: text, uppercase: false });
		const draws = calls.filter((c) => c[0] === 'strokeText' || c[0] === 'fillText');
		for (let i = 0; i < draws.length; i += 2) {
			expect(draws[i][0]).toBe('strokeText');
			expect(draws[i + 1][0]).toBe('fillText');
		}
		const fontSize = Number.parseFloat(String(calls.find((c) => c[0] === 'strokeText')![5]));
		const topFills = calls.filter((c) => c[0] === 'fillText' && c[4] === 'top');
		const bottomFills = calls.filter((c) => c[0] === 'fillText' && c[4] === 'bottom');
		expect(topFills.length).toBeGreaterThan(1);
		expect(bottomFills).toHaveLength(topFills.length);
		expect(topFills[0][3]).toBeCloseTo(0.03 * 900);
		expect((topFills[1][3] as number) - (topFills[0][3] as number)).toBeCloseTo(fontSize * 1.1);
		expect(bottomFills.at(-1)![3]).toBeCloseTo(900 - 0.03 * 900);
		expect((bottomFills.at(-1)![3] as number) - (bottomFills.at(-2)![3] as number)).toBeCloseTo(
			fontSize * 1.1
		);
	});

	it('fits captions into at most three lines of 92 percent of the width', () => {
		const { canvas, calls } = stubCanvas();
		drawMeme(canvas, image, { top: 'word '.repeat(20).trim(), bottom: '', uppercase: false });
		expect(calls.filter((c) => c[0] === 'fillText').length).toBeLessThanOrEqual(3);
		const fontSize = Number.parseFloat(String(calls.find((c) => c[0] === 'strokeText')![5]));
		for (const c of calls.filter((c) => c[0] === 'fillText')) {
			expect(measureAt(fontSize, String(c[1]))).toBeLessThanOrEqual(0.92 * 1200);
		}
	});
});

describe('renderBlob', () => {
	it('resolves with the blob from toBlob as image/png', async () => {
		const blob = new Blob(['x'], { type: 'image/png' });
		let type: string | undefined;
		const canvas = {
			toBlob: (cb: (b: Blob | null) => void, t?: string) => {
				type = t;
				cb(blob);
			}
		} as unknown as HTMLCanvasElement;
		await expect(renderBlob(canvas)).resolves.toBe(blob);
		expect(type).toBe('image/png');
	});

	it('rejects when no blob can be produced', async () => {
		const canvas = {
			toBlob: (cb: (b: Blob | null) => void) => cb(null)
		} as unknown as HTMLCanvasElement;
		await expect(renderBlob(canvas)).rejects.toThrow('Could not render the meme.');
	});
});
