import { json } from '@sveltejs/kit';
import { getClient } from '$lib/server/gemini.js';

function extractText(response) {
	if (typeof response?.text === 'string' && response.text.trim()) return response.text;
	const parts = response?.candidates?.[0]?.content?.parts ?? [];
	for (const part of parts) {
		if (part?.text) return part.text;
	}
	return '';
}

function parseJsonPayload(text) {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) return null;
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	}
}

export async function POST({ request, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { messages = [], userMessage = '', finalPrompt = '' } = await request.json();

		const transcript = [...messages, { role: 'user', content: userMessage }]
			.slice(-10)
			.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
			.join('\n');

		const instruction = `You are a concise character-prompt assistant.
Return ONLY valid JSON with this exact shape:
{
  "assistantMessage": "string",
  "finalPrompt": "string"
}
Rules:
- assistantMessage should be short and practical.
- finalPrompt should be a single high-quality generation prompt.
- Keep and improve user intent, remove fluff.
- Do not wrap JSON in markdown.`;

		const input = `Conversation:\n${transcript}\n\nCurrent prompt draft:\n${finalPrompt}`;

		const ai = getClient();
		const response = await ai.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts: [{ text: instruction }, { text: input }] }],
			config: {
				temperature: 0.45,
				candidateCount: 1,
				responseModalities: ['TEXT']
			}
		});

		const text = extractText(response);
		const parsed = parseJsonPayload(text);

		if (!parsed) {
			return json({
				assistantMessage: 'I could not structure that response. Try a more specific character direction.',
				finalPrompt
			});
		}

		return json({
			assistantMessage: parsed.assistantMessage || 'Prompt refined.',
			finalPrompt: parsed.finalPrompt || finalPrompt
		});
	} catch (error) {
		console.error('[Design Chat] Error:', error);
		return json({ error: error.message || 'Design chat failed' }, { status: 500 });
	}
}
