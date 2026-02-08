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

		const auth = getAdminAuth();
		const customToken = await auth.createCustomToken(decodedClaims.uid, {
			email: decodedClaims.email,
			name: decodedClaims.name,
			picture: decodedClaims.picture
		});

		return json({ token: customToken });
	} catch (error) {
		console.error('[get-client-token] Error:', error);
		return json({ error: error.message || 'Failed to generate token' }, { status: 500 });
	}
}
