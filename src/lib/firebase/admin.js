import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { env } from '$env/dynamic/private';

let adminApp;
let adminAuth;
let adminDb;
let adminStorage;

/**
 * Initialize Firebase Admin SDK (server-side only)
 * Used for: session verification, Firestore writes, Storage uploads
 */
function initAdmin() {
	try {
		if (getApps().length === 0) {
			const projectId = env.FIREBASE_PROJECT_ID;
			const clientEmail = env.FIREBASE_CLIENT_EMAIL;
			const privateKey = env.FIREBASE_PRIVATE_KEY;
			const storageBucket = env.FIREBASE_STORAGE_BUCKET;

			if (!projectId || !clientEmail || !privateKey) {
				console.error('[Firebase Admin] Missing credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env');
				throw new Error(
					'Firebase Admin credentials not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env'
				);
			}

			adminApp = initializeApp({
				credential: cert({
					projectId,
					clientEmail,
					privateKey: privateKey.replace(/\\n/g, '\n')
				}),
				storageBucket: storageBucket || `${projectId}.firebasestorage.app`
			});
		} else {
			adminApp = getApps()[0];
		}

		return adminApp;
	} catch (error) {
		console.error('[Firebase Admin] Initialization error:', error);
		throw error;
	}
}

/**
 * Get Firebase Admin Auth instance
 */
export function getAdminAuth() {
	if (!adminAuth) {
		initAdmin();
		adminAuth = getAuth();
	}
	return adminAuth;
}

/**
 * Get Firestore Admin instance
 */
export function getAdminDb() {
	if (!adminDb) {
		initAdmin();
		adminDb = getFirestore();
	}
	return adminDb;
}

/**
 * Get Firebase Storage bucket
 */
export function getAdminStorage() {
	if (!adminStorage) {
		initAdmin();
		adminStorage = getStorage().bucket();
	}
	return adminStorage;
}

/**
 * Verify a Firebase session cookie and return decoded claims
 * @param {string} sessionCookie - The session cookie value
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken|null>}
 */
export async function verifySessionCookie(sessionCookie) {
	if (!sessionCookie) return null;

	try {
		const auth = getAdminAuth();
		const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
		return decodedClaims;
	} catch (error) {
		console.error('Session cookie verification failed:', error.message);
		return null;
	}
}

/**
 * Verify a Firebase ID token and return decoded claims
 * @param {string} idToken - The Firebase ID token
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken|null>}
 */
export async function verifyIdToken(idToken) {
	if (!idToken) return null;

	try {
		const auth = getAdminAuth();
		const decodedToken = await auth.verifyIdToken(idToken);
		return decodedToken;
	} catch (error) {
		console.error('ID token verification failed:', error.message);
		return null;
	}
}
