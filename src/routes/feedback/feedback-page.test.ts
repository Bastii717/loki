import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const html = (form?: Record<string, unknown>) =>
	render(Page as never, { props: { data: { maxLength: 2000 }, form } as never }).body;

describe('feedback page', () => {
	it('renders the copy, the counter and a limited textarea', () => {
		const body = html();
		expect(body).toMatch(/<a[^>]*href="\/profile"[^>]*>[\s\S]*?Profile<\/a>/);
		expect(body).toMatch(/<h1[^>]*>[\s\S]*?lucide-message-circle[\s\S]*?Feedback<\/h1>/);
		expect(body).toContain(
			"Tell the admins what's on your mind — ideas, gripes, praise. It lands straight in their inbox."
		);
		expect(body).toContain('What should we know?');
		expect(body).toMatch(/<textarea[^>]*name="message"[^>]*maxlength="2000"/);
		expect(body).toContain('0 / 2000');
		expect(body).toMatch(/<input[^>]*type="checkbox"[^>]*name="anonymous"/);
		expect(body).toContain('Send anonymously');
		expect(body).toContain(
			'Your name stays out of the email — but then nobody can get back to you about it.'
		);
		expect(body).toContain('Send feedback');
	});

	it('does not disable the button server-side, so it works without JS', () => {
		expect(html()).not.toMatch(/<button[^>]*disabled/);
	});

	it('keeps what was typed after a failed submit without script', () => {
		const body = html({
			error: 'Could not send your feedback — try again later.',
			message: 'Keep me',
			anonymous: true
		});
		expect(body).toContain('Keep me</textarea>');
		expect(body).toMatch(/<input[^>]*name="anonymous"[^>]*checked/);
		expect(body).toContain('7 / 2000');
		expect(body).toContain('Could not send your feedback — try again later.');
	});

	it('thanks the member after a send without script and leaves the form empty', () => {
		const body = html({ sent: true });
		expect(body).toContain('Thanks! Your feedback is on its way.');
		expect(body).toContain('0 / 2000');
	});
});
