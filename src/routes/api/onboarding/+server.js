import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAdminDb } from '$lib/firebase/admin.js';
import { encryptSecretValue } from '$lib/server/secretVault.js';

function cleanKey(value) {
	return typeof value === 'string' ? value.trim() : '';
}

export async function POST({ request, locals }) {
	try {
		if (!locals.user?.uid) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const body = await request.json();
		const skip = !!body?.skip;
		const keys = body?.keys || {};
		const normalized = {
			gemini: cleanKey(keys.gemini),
			openai: cleanKey(keys.openai),
			runpod: cleanKey(keys.runpod)
		};

		const providedEntries = Object.entries(normalized).filter(([, value]) => !!value);
		const encryptedApiKeys = {};

		if (!skip && providedEntries.length > 0) {
			const secret = env.USER_API_KEYS_ENCRYPTION_SECRET || '';
			if (!secret) {
				return json({ error: 'Server secret not configured for API key storage' }, { status: 500 });
			}
			for (const [provider, value] of providedEntries) {
				encryptedApiKeys[provider] = {
					...encryptSecretValue(value, secret),
					updatedAt: new Date()
				};
			}
		}

		const db = getAdminDb();
		const userRef = db.collection('users').doc(locals.user.uid);
		await userRef.set(
			{
				onboarding: {
					completed: true,
					skipped: skip,
					completedAt: new Date()
				},
				apiKeyProviders: providedEntries.map(([provider]) => provider),
				hasApiKeys: providedEntries.length > 0,
				...(providedEntries.length > 0 ? { encryptedApiKeys } : {})
			},
			{ merge: true }
		);

		return json({
			success: true,
			onboardingCompleted: true,
			hasApiKeys: providedEntries.length > 0
		});
	} catch (error) {
		console.error('[api/onboarding] Failed to complete onboarding:', error);
		return json({ error: 'Failed to save onboarding details' }, { status: 500 });
	}
}

