// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: {
				uid: string;
				email: string | null;
				displayName: string | null;
				photoURL: string | null;
			} | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// ── Style Anchor ─────────────────────────────────
	/** Metadata returned by GET /api/style-anchor */
	interface StyleAnchorConfig {
		publicUrl?: string;
		mimeType?: string;
		name?: string;
		updatedAt?: string;
		updatedBy?: string;
		source: 'user' | 'local';
	}

	// ── Generation Request / Response ────────────────
	/** Payload sent to POST /api/generate-styled-character */
	interface StyledCharacterRequest {
		referenceImage?: string;   // base64 data-URL
		characterSheet?: string;   // base64 data-URL
		characterName?: string;
		characterPixels?: number;  // default 160
		canvasPixels?: number;     // default 224
	}

	/** Payload sent to POST /api/generate-character-sheet */
	interface CharacterSheetRequest {
		referenceImage: string;    // base64 data-URL (required)
		characterName?: string;
	}

	/** Response from styled character generation */
	interface StyledCharacterResponse {
		image?: string;            // base64 data-URL
		error?: string;
	}

	/** Response from character sheet generation */
	interface CharacterSheetResponse {
		sheet?: string;            // base64 data-URL
		error?: string;
	}

	/** Payload sent to PUT /api/style-anchor */
	interface StyleAnchorUpload {
		imageData: string;         // base64 data-URL or raw base64
		mimeType?: string;         // default 'image/png'
	}
}

export {};
