import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARE_TTL_MS, peekShared, putShared, takeShared } from './share-stash';

const file = { name: 'a.png', type: 'image/png', data: Buffer.from('x') };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('share stash', () => {
	it('is keyed per user and consumed by take', () => {
		putShared(1, file);
		expect(peekShared(2)).toBeNull();
		expect(takeShared(1)).toEqual(file);
		expect(takeShared(1)).toBeNull();
	});

	it('expires after the TTL', () => {
		putShared(1, file);
		vi.advanceTimersByTime(SHARE_TTL_MS + 1);
		expect(peekShared(1)).toBeNull();
	});
});
