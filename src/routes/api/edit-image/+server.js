import { json } from '@sveltejs/kit';
import { generateWithCascade, extractImage, stripDataUrl } from '$lib/server/gemini.js';

export async function POST({ request }) {
	try {
		const { image, prompt, mode } = await request.json();

		if (!image || !prompt) {
			return json({ error: 'Image and prompt are required' }, { status: 400 });
		}

		// Extract base64 from data URL
		let base64Data = stripDataUrl(image);
		let mimeType = 'image/png';
		if (image.startsWith('data:')) {
			const match = image.match(/^data:([^;]+);base64,/);
			if (match) {
				mimeType = match[1];
			}
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
