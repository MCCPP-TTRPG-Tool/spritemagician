<script>
	/**
	 * Settings — API keys and library location.
	 * Keys are saved to <dataDir>/settings.json on this machine only.
	 */
	import { onMount } from 'svelte';

	let settings = $state(null);
	let drafts = $state({});
	let saving = $state(false);
	let note = $state('');
	let error = $state('');
	let testing = $state(false);
	let testResult = $state('');

	const groups = $derived.by(() => {
		if (!settings) return [];
		const byGroup = new Map();
		for (const key of settings.keys) {
			if (!byGroup.has(key.group)) byGroup.set(key.group, []);
			byGroup.get(key.group).push(key);
		}
		return [...byGroup.entries()];
	});

	async function load() {
		error = '';
		try {
			const res = await fetch('/api/settings');
			settings = await res.json();
			drafts = {};
		} catch (err) {
			error = err.message || 'Failed to load settings';
		}
	}

	async function save() {
		saving = true;
		note = '';
		error = '';
		try {
			const keys = {};
			for (const [name, value] of Object.entries(drafts)) {
				if (value === undefined) continue;
				keys[name] = value;
			}
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ keys })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Save failed');
			settings = data;
			drafts = {};
			note = 'Saved.';
			setTimeout(() => (note = ''), 2500);
		} catch (err) {
			error = err.message || 'Save failed';
		} finally {
			saving = false;
		}
	}

	function clearKey(name) {
		drafts = { ...drafts, [name]: '' };
	}

	async function testReplicate() {
		testing = true;
		testResult = '';
		try {
			const res = await fetch('/api/test-replicate');
			const data = await res.json().catch(() => ({}));
			testResult = res.ok ? '✅ Replicate token works.' : `❌ ${data.error || `HTTP ${res.status}`}`;
		} catch (err) {
			testResult = `❌ ${err.message}`;
		} finally {
			testing = false;
		}
	}

	const hasChanges = $derived(Object.keys(drafts).length > 0);

	onMount(load);
</script>

<div class="space-y-4 text-sm">
	{#if error}
		<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
	{/if}

	{#if !settings}
		<p class="text-xs text-gray-500">Loading settings…</p>
	{:else}
		<div class="rounded-lg border border-gray-200 p-3">
			<p class="text-xs font-semibold text-gray-800">Where your files live</p>
			<p class="mt-1 font-mono text-[11px] text-gray-700 break-all">{settings.dataDir}</p>
			<p class="mt-1 text-[11px] text-gray-500">
				Sprites, animations, projects and these settings are stored in this folder. Set the
				<code>SPRITEMAGICIAN_DATA_DIR</code> environment variable before launching to use a different one.
			</p>
		</div>

		{#each groups as [group, keys]}
			<div class="rounded-lg border border-gray-200 p-3">
				<p class="text-xs font-semibold text-gray-800">{group}</p>
				<div class="mt-2 space-y-3">
					{#each keys as key}
						<div>
							<label class="block text-xs font-medium text-gray-700" for={`key-${key.name}`}>
								{key.label}
								{#if key.required}<span class="text-red-500">*</span>{/if}
								{#if key.configured && drafts[key.name] === undefined}
									<span class="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">
										set{key.source === 'env' ? ' (from environment)' : ''}
									</span>
								{/if}
							</label>
							<div class="mt-1 flex gap-2">
								<input
									id={`key-${key.name}`}
									type={key.secret ? 'password' : 'text'}
									class="flex-1 rounded border border-gray-300 px-2 py-1 text-xs font-mono"
									placeholder={key.configured ? key.preview : 'Not set'}
									value={drafts[key.name] ?? ''}
									oninput={(e) => (drafts = { ...drafts, [key.name]: e.currentTarget.value })}
									autocomplete="off"
									spellcheck="false"
								/>
								{#if key.configured && key.source === 'settings'}
									<button
										class="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
										onclick={() => clearKey(key.name)}
										title="Remove this key"
									>
										Clear
									</button>
								{/if}
							</div>
							{#if key.help}
								<p class="mt-1 text-[11px] text-gray-500">{key.help}</p>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}

		<div class="flex items-center gap-3">
			<button
				class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
				onclick={save}
				disabled={saving || !hasChanges}
			>
				{saving ? 'Saving…' : 'Save settings'}
			</button>
			<button
				class="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
				onclick={testReplicate}
				disabled={testing}
			>
				{testing ? 'Testing…' : 'Test Replicate'}
			</button>
			{#if note}<span class="text-xs text-green-700">{note}</span>{/if}
			{#if testResult}<span class="text-xs text-gray-700">{testResult}</span>{/if}
		</div>

		<p class="text-[11px] text-gray-500">
			Keys never leave this computer except to call the provider you entered them for. Usage is billed by
			each provider directly to your account.
		</p>
	{/if}
</div>
