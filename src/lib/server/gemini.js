/**
 * Gemini SDK Client — centralised wrapper around @google/genai
 *
 * Provides:
 *  - Lazy-initialised GoogleGenAI singleton
 *  - Model cascade (best → fallback) for image generation
 *  - Image extraction helpers
 *  - Style keyword constants
 */

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { env } from '$env/dynamic/private';

// ─── Singleton ───────────────────────────────────────────────
let client = null;

/** @returns {GoogleGenAI} */
export function getClient() {
	if (!client) {
		const apiKey = env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new Error('GEMINI_API_KEY not set in environment');
		}
		client = new GoogleGenAI({ apiKey });
	}
	return client;
}

// ─── Constants ───────────────────────────────────────────────

/** Model cascade: best fidelity first, fast fallback second. */
export const MODELS = [
	'gemini-3-pro-image-preview',
	'gemini-2.5-flash-image',
];

/** Canonical style-anchor keywords appended to every generation prompt. */
export const STYLE_KEYWORDS =
	'16-bit isometric pixel art, Heroes of Might and Magic 3 style, ' +
	'clean pixel-perfect lines, limited indexed color palette, ' +
	'matte textures, no gradients, transparent background';

/** Safety settings — BLOCK_NONE for dev builds. */
export const SAFETY_OFF = [
	{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ─── Generation Helpers ──────────────────────────────────────

/**
 * Generate image content using a model cascade.
 * Tries each model in order until one succeeds.
 *
 * @param {import('@google/genai').Part[]} parts - Content parts (text + inlineData)
 * @param {Partial<import('@google/genai').GenerateContentConfig>} [configOverrides] - Extra config
 * @param {number} [timeoutMs=300000] - Request timeout (default 5 min)
 * @returns {Promise<{response: import('@google/genai').GenerateContentResponse, model: string}>}
 */
export async function generateWithCascade(parts, configOverrides = {}, timeoutMs = 300_000) {
	const ai = getClient();

	for (const model of MODELS) {
		console.log(`[Gemini] Trying ${model}…`);
		try {
			const response = await ai.models.generateContent({
				model,
				contents: [{ role: 'user', parts }],
				config: {
					temperature: 0.4,
					candidateCount: 1,
					responseModalities: ['TEXT', 'IMAGE'],
					safetySettings: SAFETY_OFF,
					...configOverrides,
					abortSignal: AbortSignal.timeout(timeoutMs),
				},
			});

			// Validate we actually got candidate parts back
			if (response?.candidates?.[0]?.content?.parts?.length) {
				console.log(`[Gemini] ✓ ${model} (${response.modelVersion ?? 'unknown'})`);
				return { response, model };
			}
			console.warn(`[Gemini] ${model} returned empty candidates`);
		} catch (err) {
			// Log detailed error information for debugging
			const errorDetails = {
				model,
				message: err.message,
				status: err.status || err.statusCode,
				code: err.code,
				response: err.response ? JSON.stringify(err.response).substring(0, 500) : undefined
			};
			console.warn(`[Gemini] ${model} failed:`, errorDetails);
			
			// If it's a quota/rate limit error, log it prominently
			if (err.message?.toLowerCase().includes('quota') || 
				err.message?.toLowerCase().includes('rate limit') ||
				err.message?.includes('429') ||
				err.status === 429 ||
				err.statusCode === 429) {
				console.error(`[Gemini] ⚠️ QUOTA/RATE LIMIT ERROR for ${model}:`, err.message);
			}
		}
	}
	throw new Error('All Gemini models failed — check API key & quota');
}

/**
 * Extract the first image from a GenerateContentResponse as a base64 data-URL.
 *
 * @param {import('@google/genai').GenerateContentResponse} response
 * @returns {string|null} data:image/…;base64,… or null
 */
export function extractImage(response) {
	for (const part of response.candidates?.[0]?.content?.parts ?? []) {
		if (part.inlineData?.data) {
			const mime = part.inlineData.mimeType || 'image/png';
			return `data:${mime};base64,${part.inlineData.data}`;
		}
	}
	return null;
}

/**
 * Strip the data-URL prefix from a base64 string.
 * Returns raw base64 regardless of input format.
 *
 * @param {string} dataUrl
 * @returns {string}
 */
export function stripDataUrl(dataUrl) {
	if (!dataUrl) return '';
	if (dataUrl.startsWith('data:')) {
		const idx = dataUrl.indexOf(',');
		return idx !== -1 ? dataUrl.substring(idx + 1) : dataUrl;
	}
	return dataUrl;
}
