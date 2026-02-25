export const CHROMA_KEY_HEX = '#00FF00';
export const CHROMA_KEY_RGB = { r: 0, g: 255, b: 0 };
export const CHROMA_KEY_TOLERANCE = 60;

export const CHROMA_KEY_PROMPT_RULES = `CHROMA KEY BACKGROUND RULES (MANDATORY):
- Background must be a flat solid chroma key lime green: ${CHROMA_KEY_HEX}.
- Use this exact chroma key color for background only.
- Subject must not contain this exact chroma key lime green anywhere.
- If subject naturally has green materials, shift them away from ${CHROMA_KEY_HEX} while preserving readability.`;
