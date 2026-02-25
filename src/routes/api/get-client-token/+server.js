/**
 * GET /api/get-client-token
 * 
 * Returns a Firebase custom token that can be used to sign in client-side
 * Firebase auth. This allows Firestore security rules to work properly.
 * 
 * Requires: Valid session cookie
 * Returns: { token: string }
 */
import { json } from '@sveltejs/kit';
import { getAdminAuth } from '$lib/firebase/admin.js';
import { verifySessionCookie } from '$lib/firebase/admin.js';
import { enforceRateLimit } from '$lib/server/security.js';
import { recordUsageEvent } from '$lib/server/requestTracking.js';

export async function GET({ cookies }) {
	try {
		const sessionCookie = cookies.get('__session');
		if (!sessionCookie) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const decodedClaims = await verifySessionCookie(sessionCookie);
		if (!decodedClaims) {
			return json({ error: 'Invalid session' }, { status: 401 });
		}
		const rate = enforceRateLimit({
			uid: decodedClaims.uid,
			routeKey: 'get-client-token',
			maxRequests: 30,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}

		const auth = getAdminAuth();
		const customToken = await auth.createCustomToken(decodedClaims.uid, {
			email: decodedClaims.email,
			name: decodedClaims.name,
			picture: decodedClaims.picture
		});

		await recordUsageEvent({
			uid: decodedClaims.uid,
			routeKey: 'get-client-token',
			provider: 'firebase',
			statusCode: 200,
			requestBytes: 0
		});
		return json({ token: customToken });
	} catch (error) {
		console.error('[get-client-token] Error:', error);
		return json({ error: error.message || 'Failed to generate token' }, { status: 500 });
	}
}
