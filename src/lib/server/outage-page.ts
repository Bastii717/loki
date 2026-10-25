import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Next to the source under `vite dev` and vitest; the working directory covers the adapter-node build. */
function readPage(): string {
	try {
		return readFileSync(new URL('../../../static/maintenance.html', import.meta.url), 'utf8');
	} catch {
		return readFileSync(join(process.cwd(), 'static/maintenance.html'), 'utf8');
	}
}

const page = readPage();

/** The static outage page, served with 503 while the database or the migrations are not ready. */
export function outagePage(): Response {
	return new Response(page, {
		status: 503,
		headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30' }
	});
}
