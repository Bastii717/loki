// inlined by Vite: the production image ships `build/` only, there is no `static/` to read at runtime
import maintenanceHtml from '../../../static/maintenance.html?raw';

/** The static outage page, served with 503 while the database or the migrations are not ready. */
export function outagePage(): Response {
	return new Response(maintenanceHtml, {
		status: 503,
		headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30' }
	});
}
