import { json } from '@sveltejs/kit';
import { generateWithCascade, extractImage, stripDataUrl } from '$lib/server/gemini.js';

export async function POST({ request }) {
	try {
		const { image, prompt, mode } = await request.json();

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
			return json({ 
				error: 'No image generated in response',
				details: `Model ${model} returned response but no image data was found`
			}, { status: 500 });
		}

		console.log(`[Edit Image] Successfully generated edited image via ${model}`);
		return json({ image: generatedImage });

	} catch (error) {
		console.error('[Edit Image] Error:', error);
		console.error('[Edit Image] Stack:', error.stack);
		if (error.name === 'AbortError') {
			return json({ error: 'Request timed out after 5 minutes' }, { status: 504 });
		}
		// Ensure error message is serializable
		const errorMessage = error.message || 'Unknown error occurred';
		return json({ error: errorMessage }, { status: 500 });
	}
}
