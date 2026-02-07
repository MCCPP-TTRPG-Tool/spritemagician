/**
 * Style Anchor API
 *
 * GET  → Returns current master style metadata (source, name, preview URL)
 * PUT  → Uploads a new master style image (base64 body)
 *
 * The master style image is attached to every generation request
 * to lock the output aesthetic to the HoMM3 pixel-art style.
 */

import { json } from '@sveltejs/kit';
import { getStyleConfig, setMasterStyle, clearStyleCache } from '$lib/server/styleAnchor.js';

/**
 * GET /api/style-anchor
 * Returns metadata about the current master style (no image bytes).
 */
export async function GET({ locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const config = await getStyleConfig();
	return json({ styleAnchor: config });
}

/**
 * PUT /api/style-anchor
 * Upload a new master style image.
 *
 * Body: { imageData: "data:image/png;base64,…" | "raw-base64", mimeType?: "image/png" }
 */
export async function PUT({ request, locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		const { imageData, mimeType } = await request.json();
		if (!imageData) {
			return json({ error: 'imageData is required' }, { status: 400 });
		}

		// Strip data-URL prefix if present
		let base64 = imageData;
		if (base64.startsWith('data:')) {
			const idx = base64.indexOf(',');
			base64 = idx !== -1 ? base64.substring(idx + 1) : base64;
		}

		// Detect mime from data-URL or use provided value
		let resolvedMime = mimeType || 'image/png';
		if (imageData.startsWith('data:')) {
			const match = imageData.match(/^data:([^;,]+)/);
			if (match) resolvedMime = match[1];
		}

		const result = await setMasterStyle(base64, resolvedMime, locals.user.uid);

		return json({
			ok: true,
			publicUrl: result.publicUrl,
			storagePath: result.storagePath,
		});

	} catch (error) {
		console.error('[StyleAnchor] PUT error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}

/**
 * DELETE /api/style-anchor
 * Clears the style cache (forces reload on next generation).
 */
export async function DELETE({ locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	clearStyleCache();
	return json({ ok: true, message: 'Style cache cleared' });
}
