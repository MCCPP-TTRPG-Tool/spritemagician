import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		// Bundle every server dependency into build/ so the Electron package
		// does not need node_modules at runtime.
		noExternal: true
	}
});
