import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const MODEL_VERSION = '15430b300f8c044e8f9e3567fd6daadf6d62e9bb0cee23fdb7969d3b26542f40';

function getOutputUrl(output) {
	if (typeof output === 'string') return output;
	if (Array.isArray(output)) return output.find((item) => typeof item === 'string') || null;
	return null;
}

export async function POST({ request }) {
	if (!env.REPLICATE_API_TOKEN) {
		return json({ error: 'REPLICATE_API_TOKEN is missing. Add it to .env and restart the dev server.' }, { status: 500 });
	}

	try {
		const body = await request.json();
		const characterImage = typeof body.characterImage === 'string' ? body.characterImage : '';
		const drivingVideo = typeof body.drivingVideo === 'string' ? body.drivingVideo : '';

		if (!characterImage.startsWith('data:image/')) {
			return json({ error: 'Upload a character image first.' }, { status: 400 });
		}
		if (!drivingVideo.startsWith('data:video/')) {
			return json({ error: 'Upload a short driving video first.' }, { status: 400 });
		}

		const input = {
			image: characterImage,
			video: drivingVideo,
			prompt: 'Transfer the performer motion to the character. Preserve the character identity, framing, clothing, and background.',
			mode: 'std',
			character_orientation: 'image',
			keep_original_sound: false
		};

		const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
			method: 'POST',
			headers: {
				Authorization: `Token ${env.REPLICATE_API_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ version: MODEL_VERSION, input })
		});

		if (!createResponse.ok) {
			const details = await createResponse.text();
			throw new Error(`Kling 3.0 request failed (${createResponse.status}): ${details}`);
		}

		const prediction = await createResponse.json();
		return json({ predictionId: prediction.id, status: prediction.status || 'starting' });
	} catch (error) {
		console.error('[kling-motion] generation failed:', error);
		return json({ error: error instanceof Error ? error.message : 'Kling 3.0 generation failed.' }, { status: 500 });
	}
}

export async function GET({ url }) {
	if (!env.REPLICATE_API_TOKEN) {
		return json({ error: 'REPLICATE_API_TOKEN is missing.' }, { status: 500 });
	}

	const predictionId = url.searchParams.get('id') || '';
	if (!/^[a-z0-9]+$/i.test(predictionId)) {
		return json({ error: 'A valid portrait-motion job ID is required.' }, { status: 400 });
	}

	try {
		const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
			headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` }
		});
		if (!response.ok) {
			throw new Error(`Could not read Kling 3.0 status (${response.status}).`);
		}

		const prediction = await response.json();
		return json({
			predictionId: prediction.id,
			status: prediction.status,
			videoUrl: prediction.status === 'succeeded' ? getOutputUrl(prediction.output) : null,
			error: prediction.error || null
		});
	} catch (error) {
		console.error('[kling-motion] status failed:', error);
		return json({ error: error instanceof Error ? error.message : 'Could not read Kling 3.0 status.' }, { status: 500 });
	}
}
