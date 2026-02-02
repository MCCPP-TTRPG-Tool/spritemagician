import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { env } from '$env/dynamic/private';

let storage;

/**
 * Initialize Firebase Admin if not already initialized
 */
function initFirebase() {
	if (getApps().length === 0) {
		const projectId = env.FIREBASE_PROJECT_ID;
		const clientEmail = env.FIREBASE_CLIENT_EMAIL;
		const privateKey = env.FIREBASE_PRIVATE_KEY;
		const storageBucket = env.FIREBASE_STORAGE_BUCKET;

		if (!projectId || !clientEmail || !privateKey) {
			throw new Error('Firebase credentials not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env');
		}

		initializeApp({
			credential: cert({
				projectId,
				clientEmail,
				privateKey: privateKey.replace(/\\n/g, '\n')
			}),
			storageBucket: storageBucket || `${projectId}.firebasestorage.app`
		});
	}

	if (!storage) {
		storage = getStorage().bucket();
	}

	return storage;
}

/**
 * Upload an image to Firebase Storage and return a public URL
 * @param {string} imageData - Base64 data URL or base64 string
 * @param {string} filename - Optional filename (defaults to timestamp)
 * @returns {Promise<string>} Public URL of the uploaded image
 */
export async function uploadImageToFirebase(imageData, filename = null) {
	try {
		const bucket = initFirebase();
		
		// Extract base64 from data URL if needed
		let base64Data = imageData;
		if (imageData.startsWith('data:')) {
			const base64Index = imageData.indexOf(',');
			if (base64Index !== -1) {
				base64Data = imageData.substring(base64Index + 1);
			}
		}

		// Convert base64 to buffer
		const buffer = Buffer.from(base64Data, 'base64');
		
		// Generate filename if not provided
		const filePath = filename || `sprites/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
		
		// Upload to Firebase Storage
		const file = bucket.file(filePath);
		await file.save(buffer, {
			metadata: {
				contentType: 'image/png',
				cacheControl: 'public, max-age=3600'
			},
			public: true // Make file publicly accessible
		});

		// Make the file publicly accessible
		await file.makePublic();

		// Return public URL
		return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
	} catch (error) {
		console.error('Firebase upload error:', error);
		throw new Error(`Failed to upload image to Firebase: ${error.message}`);
	}
}

/**
 * Delete an image from Firebase Storage
 * @param {string} url - Public URL of the image to delete
 */
export async function deleteImageFromFirebase(url) {
	try {
		const bucket = initFirebase();
		// Extract file path from URL
		const urlParts = url.split('/');
		const filePath = urlParts.slice(urlParts.indexOf(bucket.name) + 1).join('/');
		
		await bucket.file(filePath).delete();
	} catch (error) {
		console.error('Firebase delete error:', error);
		// Don't throw - deletion failures aren't critical
	}
}

