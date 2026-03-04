<script>
	import { goto } from '$app/navigation';

	let mode = $state('choice'); // choice | keys
	let isSaving = $state(false);
	let error = $state('');
	let geminiKey = $state('');
	let openaiKey = $state('');
	let runpodKey = $state('');

	async function completeSetup(skip = false) {
		if (isSaving) return;
		isSaving = true;
		error = '';
		try {
			const payload = skip
				? { skip: true }
				: {
						skip: false,
						keys: {
							gemini: geminiKey,
							openai: openaiKey,
							runpod: runpodKey
						}
					};

			const response = await fetch('/api/onboarding', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || 'Failed to complete setup');
			}

			goto('/', { replaceState: true, invalidateAll: true });
		} catch (err) {
			error = err?.message || 'Failed to complete setup';
		} finally {
			isSaving = false;
		}
	}
</script>

<svelte:head>
	<title>Account Setup - Sprite Magician</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
	<div class="w-full max-w-xl bg-white rounded-xl shadow-lg border p-6">
		<h1 class="text-xl font-bold text-gray-900">New Account Setup</h1>
		<p class="text-sm text-gray-600 mt-1">
			Add your API keys now, or continue without keys and set them later.
		</p>

		{#if error}
			<div class="mt-4 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">
				{error}
			</div>
		{/if}

		{#if mode === 'choice'}
			<div class="mt-5 grid sm:grid-cols-2 gap-3">
				<button
					class="rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 p-4 text-left"
					onclick={() => mode = 'keys'}
				>
					<p class="text-sm font-semibold">Submit API Keys</p>
					<p class="text-xs mt-1 text-blue-700">Configure Gemini/OpenAI/RunPod now.</p>
				</button>

				<button
					class="rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800 p-4 text-left"
					onclick={() => completeSetup(true)}
					disabled={isSaving}
				>
					<p class="text-sm font-semibold">Proceed Without Keys</p>
					<p class="text-xs mt-1 text-gray-600">Skip setup and continue to Home.</p>
				</button>
			</div>
		{:else}
			<div class="mt-5 space-y-3">
				<div>
					<label class="block text-xs font-medium text-gray-700 mb-1" for="gemini-key">Gemini API Key (optional)</label>
					<input
						id="gemini-key"
						type="password"
						class="w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
						bind:value={geminiKey}
						placeholder="AIza..."
						autocomplete="off"
					/>
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-700 mb-1" for="openai-key">OpenAI API Key (optional)</label>
					<input
						id="openai-key"
						type="password"
						class="w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
						bind:value={openaiKey}
						placeholder="sk-..."
						autocomplete="off"
					/>
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-700 mb-1" for="runpod-key">RunPod API Key (optional)</label>
					<input
						id="runpod-key"
						type="password"
						class="w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
						bind:value={runpodKey}
						placeholder="runpod_..."
						autocomplete="off"
					/>
				</div>
				<div class="flex gap-2 pt-1">
					<button
						class="px-3 py-2 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
						onclick={() => mode = 'choice'}
						disabled={isSaving}
					>
						Back
					</button>
					<button
						class="px-3 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
						onclick={() => completeSetup(false)}
						disabled={isSaving}
					>
						{isSaving ? 'Saving...' : 'Complete Setup'}
					</button>
					<button
						class="px-3 py-2 text-xs rounded border border-gray-300 bg-gray-50 hover:bg-gray-100"
						onclick={() => completeSetup(true)}
						disabled={isSaving}
					>
						Skip for now
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

