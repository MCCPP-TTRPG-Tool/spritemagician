/**
 * GET  /api/settings          → masked keys, data dir, preferences
 * PUT  /api/settings { keys?: {NAME: value|null}, preferences?: {...} }
 */
import { json } from '@sveltejs/kit';
import { describeSettings, setSecrets, setPreferences } from '$lib/server/settings.js';

export async function GET() {
	return json(describeSettings());
}

export async function PUT({ request }) {
	try {
		const body = await request.json();
		if (body?.keys && typeof body.keys === 'object') setSecrets(body.keys);
		if (body?.preferences && typeof body.preferences === 'object') setPreferences(body.preferences);
		return json(describeSettings());
	} catch (error) {
		return json({ error: error.message || 'Failed to save settings' }, { status: 400 });
	}
}
