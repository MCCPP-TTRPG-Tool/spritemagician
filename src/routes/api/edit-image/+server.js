import { json } from '@sveltejs/kit';
import { generateWithCascade, extractImage, stripDataUrl } from '$lib/server/gemini.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { image, prompt, mode } = await request.json();
		const payload = { image, prompt, mode };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 6 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'edit-image',
			maxRequests: 15,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}
		if (idempotencyKey) {
			const idempotency = await beginIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'edit-image',
				idempotencyKey,
				requestHash
			});
			if (idempotency.status === 'replay') {
				return json(idempotency.responseBody, { status: idempotency.responseStatus });
			}
			if (idempotency.status === 'processing') {
				return json(
					{ error: 'A request with this Idempotency-Key is already processing.' },
					{ status: 409 }
				);
			}
			if (idempotency.status === 'conflict') {
				return json(
					{ error: 'Idempotency-Key already used with different payload.' },
					{ status: 409 }
				);
			}
		}

		if (!image || !prompt) {
			return json({ error: 'Image and prompt are required' }, { status: 400 });
		}

		// Handle both data URLs and HTTP URLs
		let base64Data;
		let mimeType = 'image/png';
		
		if (image.startsWith('data:')) {
			// Data URL - extract base64 and mime type
			const match = image.match(/^data:([^;]+);base64,/);
			if (match) {
				mimeType = match[1];
			}
			base64Data = stripDataUrl(image);
		} else if (image.startsWith('http://') || image.startsWith('https://')) {
			// HTTP URL - download and convert to base64
			console.log(`[Edit Image] Downloading image from URL: ${image.substring(0, 80)}...`);
			try {
				const response = await fetch(image);
				if (!response.ok) {
					throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
				}
				
				const contentType = response.headers.get('content-type') || 'image/png';
				mimeType = contentType;
				const arrayBuffer = await response.arrayBuffer();
				base64Data = Buffer.from(arrayBuffer).toString('base64');
				console.log(`[Edit Image] Downloaded and converted to base64 (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)`);
			} catch (fetchError) {
				console.error('[Edit Image] Failed to download image:', fetchError);
				await recordUsageEvent({
					uid: locals.user.uid,
					routeKey: 'edit-image',
					provider: 'gemini',
					success: false,
					statusCode: 400,
					requestBytes: payloadBytes,
					metadata: { error: String(fetchError.message || 'download failed').slice(0, 200) }
				});
				return json({ 
					error: 'Failed to download image from URL',
					details: fetchError.message 
				}, { status: 400 });
			}
		} else {
			// Assume it's already base64 (no prefix)
			base64Data = image;
		}

		console.log(`[Edit Image] Mode: ${mode}, prompt: ${prompt.substring(0, 80)}...`);

		// Build multimodal parts using the same format as other endpoints
		const parts = [
			{ text: 'SOURCE IMAGE:' },
			{ inlineData: { mimeType, data: base64Data } },
			{ text: prompt }
		];

		// Use the same cascade helper as other endpoints
		let response, model;
		try {
			const result = await generateWithCascade(parts, {
				temperature: 0.4,
			});
			response = result.response;
			model = result.model;
		} catch (cascadeError) {
			console.error('[Edit Image] Cascade failed:', cascadeError);
			// Provide more helpful error message
			if (cascadeError.message?.includes('All Gemini models failed')) {
				await recordUsageEvent({
					uid: locals.user.uid,
					routeKey: 'edit-image',
					provider: 'gemini',
					success: false,
					statusCode: 500,
					requestBytes: payloadBytes,
					metadata: { error: 'All Gemini models failed' }
				});
				return json({ 
					error: 'Image editing failed. Please check your GEMINI_API_KEY is set correctly and has quota remaining.',
					details: cascadeError.message 
				}, { status: 500 });
			}
			throw cascadeError; // Re-throw to be caught by outer catch
		}

		const generatedImage = extractImage(response);
		if (!generatedImage) {
			console.error('[Edit Image] No image in response from', model);
			console.error('[Edit Image] Response structure:', JSON.stringify(response, null, 2).substring(0, 500));
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'edit-image',
				provider: 'gemini',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: 'No image generated in response' }
			});
			return json({ 
				error: 'No image generated in response',
				details: `Model ${model} returned response but no image data was found`
			}, { status: 500 });
		}

		console.log(`[Edit Image] Successfully generated edited image via ${model}`);
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'edit-image',
			provider: 'gemini',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { mode: mode || 'edit', model: model || 'unknown' }
		});
		const responseBody = { image: generatedImage };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'edit-image',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		return json(responseBody);

	} catch (error) {
		console.error('[Edit Image] Error:', error);
		console.error('[Edit Image] Stack:', error.stack);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'edit-image',
					idempotencyKey,
					requestHash,
					errorMessage: error.message
				});
			} catch {
				// best effort
			}
		}
		if (error.name === 'AbortError') {
			if (locals.user?.uid) {
				await recordUsageEvent({
					uid: locals.user.uid,
					routeKey: 'edit-image',
					provider: 'gemini',
					success: false,
					statusCode: 504,
					requestBytes: payloadBytes,
					metadata: { error: 'Request timed out' }
				});
			}
			return json({ error: 'Request timed out after 5 minutes' }, { status: 504 });
		}
		// Ensure error message is serializable
		const errorMessage = error.message || 'Unknown error occurred';
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'edit-image',
				provider: 'gemini',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(errorMessage).slice(0, 200) }
			});
		}
		return json({ error: errorMessage }, { status: 500 });
	}
}
