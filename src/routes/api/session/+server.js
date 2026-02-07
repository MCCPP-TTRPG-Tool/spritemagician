/**
 * Session API — create and destroy HTTP-only session cookies
 *
 * POST: Exchange a Firebase ID token for a session cookie
 * DELETE: Clear the session cookie (logout)
 */

import { json } from '@sveltejs/kit';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin.js';

// Session cookie lasts 14 days
const SESSION_EXPIRY_MS = 60 * 60 * 24 * 14 * 1000;

/**
 * POST — Login: exchange ID token for session cookie
 */
export async function POST({ request, cookies }) {
	try {
		const { idToken } = await request.json();

		if (!idToken) {
			return json({ error: 'ID token required' }, { status: 400 });
		}

		const auth = getAdminAuth();

		// Verify the ID token first
		const decodedToken = await auth.verifyIdToken(idToken);

		// Only allow tokens issued recently (within 5 minutes) to prevent replay
		const tokenAge = Date.now() / 1000 - decodedToken.auth_time;
		if (tokenAge > 5 * 60) {
			return json({ error: 'Token too old. Please sign in again.' }, { status: 401 });
		}

		// Create session cookie
		const sessionCookie = await auth.createSessionCookie(idToken, {
			expiresIn: SESSION_EXPIRY_MS
		});

		// Set HTTP-only cookie (on localhost, secure must be false)
		const isLocalhost = request.url.includes('localhost') || request.url.includes('127.0.0.1');
		cookies.set('__session', sessionCookie, {
			path: '/',
			httpOnly: true,
			secure: !isLocalhost,
			sameSite: 'lax',
			maxAge: SESSION_EXPIRY_MS / 1000
		});

		// Create/update user document in Firestore (non-blocking — don't fail login if Firestore is unavailable)
		try {
			const db = getAdminDb();
			const userRef = db.collection('users').doc(decodedToken.uid);
			const userDoc = await userRef.get();

			if (!userDoc.exists) {
				await userRef.set({
					email: decodedToken.email || null,
					displayName: decodedToken.name || null,
					photoURL: decodedToken.picture || null,
					createdAt: new Date(),
					lastLoginAt: new Date(),
					isAdmin: false
				});
			} else {
				await userRef.update({
					lastLoginAt: new Date(),
					displayName: decodedToken.name || userDoc.data().displayName,
					photoURL: decodedToken.picture || userDoc.data().photoURL
				});
			}
		} catch (firestoreError) {
			// Log but don't fail — session cookie is already set
			console.warn('Firestore user doc write failed (non-critical):', firestoreError.message);
		}

		return json({
			success: true,
			user: {
				uid: decodedToken.uid,
				email: decodedToken.email,
				displayName: decodedToken.name,
				photoURL: decodedToken.picture
			}
		});
	} catch (error) {
		console.error('Session creation error:', error);
		return json({ error: 'Failed to create session' }, { status: 401 });
	}
}

/**
 * DELETE — Logout: clear session cookie
 */
export async function DELETE({ cookies }) {
	cookies.delete('__session', { path: '/' });
	return json({ success: true });
}
