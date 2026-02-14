/**
 * POST /api/replace-file
 *
 * Replaces an existing file in Firebase Storage by overwriting it.
 * Used when updating files (e.g., background removal) to avoid creating duplicates.
 *
 * Body: { imageData: string, existingUrl: string }
 * Returns: { url: string, path: string }
 */
import { json } from '@sveltejs/kit';
import { uploadImageToFirebase, deleteImageFromFirebase } from '$lib/utils/firebaseStorage.js';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { env } from '$env/dynamic/private';

function initFirebase() {
	if (getApps().length === 0) {
		const projectId = env.FIREBASE_PROJECT_ID;
		const clientEmail = env.FIREBASE_CLIENT_EMAIL;
		const privateKey = env.FIREBASE_PRIVATE_KEY;
		const storageBucket = env.FIREBASE_STORAGE_BUCKET;

		if (!projectId || !clientEmail || !privateKey) {
			throw new Error('Firebase credentials not configured');
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

	return getStorage().bucket();
}

/**
 * Extract storage path from a Firebase Storage URL
 */
function extractStoragePath(url, bucketName) {
	try {
		// Handle both formats:
		// https://storage.googleapis.com/BUCKET_NAME/path/to/file.png
		// https://BUCKET_NAME.storage.googleapis.com/path/to/file.png
		const urlObj = new URL(url);
		let path = '';
		
		if (urlObj.hostname.includes('storage.googleapis.com')) {
			// Extract path after bucket name
			const parts = urlObj.pathname.split('/');
			const bucketIndex = parts.findIndex(p => p === bucketName || p.includes(bucketName));
			if (bucketIndex !== -1) {
				path = parts.slice(bucketIndex + 1).join('/');
			} else {
				// Fallback: use pathname directly (minus leading slash)
				path = urlObj.pathname.substring(1);
			}
		} else {
			// Fallback: try to extract from pathname
			path = urlObj.pathname.substring(1);
		}
		
		return path;
	} catch (error) {
		console.error('[replace-file] Failed to extract path from URL:', url, error);
		return null;
	}
}

export async function POST({ request, locals }) {
	try {
		const user = locals.user;
		if (!user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const { imageData, existingUrl } = await request.json();

		if (!imageData) {
			return json({ error: 'imageData is required' }, { status: 400 });
		}

		if (!existingUrl) {
			return json({ error: 'existingUrl is required' }, { status: 400 });
		}

		const bucket = initFirebase();
		const bucketName = bucket.name;
		
		// Extract the storage path from the existing URL
		const storagePath = extractStoragePath(existingUrl, bucketName);
		
		if (!storagePath) {
			return json({ error: 'Could not extract storage path from existing URL' }, { status: 400 });
		}

		// Detect content type
		const detectContentType = (dataUrl) => {
			if (dataUrl && dataUrl.startsWith('data:')) {
				const match = dataUrl.match(/^data:([^;,]+)/);
				if (match && match[1]) return match[1];
			}
			return 'image/png';
		};

		const contentType = detectContentType(imageData);

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

		// Overwrite the existing file in Firebase Storage
		const file = bucket.file(storagePath);
		await file.save(buffer, {
			metadata: {
				contentType,
				cacheControl: 'public, max-age=3600'
			},
			public: true
		});

		// Make sure it's publicly accessible
		await file.makePublic();

		// Return the same URL (since we overwrote the file)
		const publicUrl = `https://storage.googleapis.com/${bucketName}/${storagePath}`;
		
		return json({ url: publicUrl, path: storagePath });

	} catch (error) {
		console.error('[replace-file] Error:', error);
		return json({ error: error.message || 'File replacement failed' }, { status: 500 });
	}
}
