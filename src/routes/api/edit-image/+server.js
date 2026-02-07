import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function POST({ request }) {
	try {
		const { image, prompt, mode } = await request.json();

		if (!image || !prompt) {
			return json({ error: 'Image and prompt are required' }, { status: 400 });
		}

		if (!env.GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' }, { status: 500 });
		}

		// Extract base64 from data URL
		let base64Data = image;
		let mimeType = 'image/png';
		if (image.startsWith('data:')) {
			const match = image.match(/^data:([^;]+);base64,(.+)$/);
			if (match) {
				mimeType = match[1];
				base64Data = match[2];
			}
		}

		console.log(`[Edit Image] Mode: ${mode}, prompt: ${prompt.substring(0, 80)}...`);

		const parts = [
			{ text: 'SOURCE IMAGE:' },
			{ inline_data: { mime_type: mimeType, data: base64Data } },
			{ text: prompt }
		];

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ parts }],
					generationConfig: {
						responseModalities: ['TEXT', 'IMAGE']
					}
				})
			}
		);

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[Edit Image] Gemini API error:', response.status, errorText);
			return json({ error: `Gemini API error: ${response.status}`, details: errorText }, { status: 500 });
		}

		const result = await response.json();
		return processResult(result);

	} catch (error) {
		console.error('[Edit Image] Error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}

function processResult(result) {
	let generatedImage = null;

	if (result.candidates?.[0]?.content?.parts) {
		for (const part of result.candidates[0].content.parts) {
			const data = part.inlineData?.data || part.inline_data?.data;
			if (data) {
				generatedImage = `data:image/png;base64,${data}`;
				break;
			}
		}
	}

	if (!generatedImage) {
		console.error('[Edit Image] No image in response:', JSON.stringify(result).substring(0, 200));
		return json({ error: 'No image generated', details: JSON.stringify(result) }, { status: 500 });
	}

	console.log('[Edit Image] Successfully generated edited image');
	return json({ image: generatedImage });
}
