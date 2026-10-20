import { afterEach, describe, expect, it } from 'vitest';
import { resetDb } from './test-utils';

const original = process.env.VITEST;
afterEach(() => {
	if (original === undefined) delete process.env.VITEST;
	else process.env.VITEST = original;
});

describe('resetDb guard', () => {
	it('refuses to truncate when not running under vitest', async () => {
		delete process.env.VITEST;
		await expect(resetDb()).rejects.toThrow(/only run under vitest/);
	});
});
