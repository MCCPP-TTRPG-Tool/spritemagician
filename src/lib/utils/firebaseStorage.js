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
 * Detect MIME content type from a data URL, filename extension, or fallback to png.
 * @param {string} dataUrl - The data URL or raw base64 string
 * @param {string|null} filename - Optional filename to infer type from extension
 * @returns {string} MIME type (e.g. 'image/png', 'image/webp', 'video/mp4')
 */
function detectContentType(dataUrl, filename) {
	// 1. Try extracting from data URL prefix  e.g. data:image/webp;base64,...
	if (dataUrl && dataUrl.startsWith('data:')) {
		const match = dataUrl.match(/^data:([^;,]+)/);
		if (match && match[1]) return match[1];
	}

	// 2. Infer from filename extension
	if (filename) {
		const ext = filename.split('.').pop()?.toLowerCase();
		const extMap = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			webp: 'image/webp',
			svg: 'image/svg+xml',
			mp4: 'video/mp4',
			webm: 'video/webm'
		};
		if (ext && extMap[ext]) return extMap[ext];
	}

	// 3. Default
	return 'image/png';
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
		
		// Detect content type BEFORE stripping the data URL prefix
		const contentType = detectContentType(imageData, filename);

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
				contentType,
				cacheControl: 'public, max-age=3600'
			},
			public: true // Make file publicly accessible
		});

		// Make the file publicly accessible
		await file.makePublic();

		// Return public URL
		const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
		console.log(`[Firebase] Uploaded ${filePath} (${contentType}, ${(buffer.length / 1024).toFixed(1)} KB)`);
		return publicUrl;
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

