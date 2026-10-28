/**
 * GET /api/test-replicate — verifies the configured Replicate token.
 */
import { json } from '@sveltejs/kit';
import { env } from '$lib/server/env.js';

export async function GET() {
	const token = env.REPLICATE_API_TOKEN;
	if (!token) {
		return json({ error: 'Replicate API token is not set. Add it in Settings.' }, { status: 400 });
	}
	try {
		const res = await fetch('https://api.replicate.com/v1/account', {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			return json({ error: `Replicate rejected the token (HTTP ${res.status})` }, { status: 400 });
		}
		const account = await res.json();
		return json({ ok: true, username: account?.username || null, type: account?.type || null });
	} catch (error) {
		return json({ error: error.message || 'Could not reach Replicate' }, { status: 502 });
	}
}
