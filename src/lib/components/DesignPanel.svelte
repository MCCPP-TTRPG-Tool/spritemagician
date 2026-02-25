<script>
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import { projectStore } from '$lib/stores/project.js';
	import {
		appendDesignMessage,
		designStore,
		deleteSavedConversation,
		loadSavedConversation,
		resetCurrentConversation,
		saveCurrentConversation,
		updateDesignState
	} from '$lib/stores/design.js';

	const GENESIS_PRESET = 'hyper-detailed concept art, cinematic lighting, oil painting strokes, high-resolution,, studio render lighting, volumetric depth, moody atmospheric tone, digital painting in the style of 1980s fantasy art';

	const CONTENT_PRESETS = {
		character: 'Create a game-ready character design with a clear silhouette and strong identity.',
		building: 'Create a game-ready building design with readable structure and architectural detail.',
		item: 'Create a game-ready item design with clear shape language and material readability.',
		asset: 'Create a reusable game asset concept with practical visual clarity and modularity.',
		scenery: 'Create a game-ready scenery concept with composition depth and environmental storytelling.',
		effects: 'Create a game-ready special effects concept emphasizing motion, glow, and layered energy.'
	};

	const STYLE_PRESETS = {
		default: '',
		diablo2: 'Theme add-on: dark gothic fantasy in the spirit of Diablo II, moody lighting, gritty textures, dramatic contrast, somber medieval atmosphere.'
	};

	let isChatting = $state(false);
	let isGenerating = $state(false);
	let chatError = $state(null);
	let generationError = $state(null);
	let userInput = $state('');
	let saveName = $state('');
	let selectedConversationId = $state('');
	let chatMessagesEl;

	$effect(() => {
		if ($designStore.mode !== 'chat') return;
		$designStore.messages.length;
		tick().then(() => {
			if (!chatMessagesEl) return;
			chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
		});
	});

	function setMode(mode) {
		updateDesignState({ mode });
	}

	function applyPreset() {
		updateDesignState({ draftPrompt: GENESIS_PRESET });
	}

	function usePromptInGenesis() {
		updateDesignState({ mode: 'genesis' });
	}

	function buildGenesisPrompt(basePrompt, contentPreset, stylePreset) {
		const contentAddon = CONTENT_PRESETS[contentPreset] || '';
		const styleAddon = STYLE_PRESETS[stylePreset] || '';
		return [basePrompt?.trim(), contentAddon, styleAddon].filter(Boolean).join('\n\n');
	}

	async function sendChat() {
		const text = userInput.trim();
		if (!text || isChatting) return;

		chatError = null;
		isChatting = true;
		userInput = '';

		const before = get(designStore);
		const outgoingMessages = [...before.messages, { role: 'user', content: text }];
		appendDesignMessage({ role: 'user', content: text });

		try {
			const response = await fetch('/api/design-chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: before.messages,
					userMessage: text,
					finalPrompt: before.draftPrompt
				})
			});

			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Design chat failed');

			appendDesignMessage({ role: 'assistant', content: data.assistantMessage || 'Updated.' });
			if (data.finalPrompt) {
				updateDesignState({ draftPrompt: data.finalPrompt });
			}
		} catch (err) {
			chatError = err.message;
			appendDesignMessage({ role: 'assistant', content: 'Chat failed. Try again.' });
		}

		isChatting = false;
	}

	async function generateGenesis() {
		const state = get(designStore);
		if (!state.draftPrompt.trim() || isGenerating) return;

		isGenerating = true;
		generationError = null;
		updateDesignState({ generatedImage: null });

		try {
			const prompt = buildGenesisPrompt(state.draftPrompt, state.contentPreset, state.stylePreset);
			const response = await fetch('/api/generate-sprite', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt, referenceImage: null })
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Genesis generation failed');
			updateDesignState({ generatedImage: data.image });
		} catch (err) {
			generationError = err.message;
		}

		isGenerating = false;
	}

	function saveConversation() {
		const state = get(designStore);
		const fallback = `Conversation ${new Date().toLocaleString()}`;
		saveCurrentConversation(saveName.trim() || fallback);
		saveName = '';
	}

	function loadConversation() {
		if (!selectedConversationId) return;
		loadSavedConversation(selectedConversationId);
	}

	function deleteConversation() {
		if (!selectedConversationId) return;
		deleteSavedConversation(selectedConversationId);
		selectedConversationId = '';
	}

	function useIn(targetTab) {
		const state = get(designStore);
		if (!state.generatedImage) return;

		if (targetTab === 'edit') {
			projectStore.update((p) => ({ ...p, editImage: state.generatedImage }));
		} else if (targetTab === 'style') {
			projectStore.update((p) => ({ ...p, styleImage: state.generatedImage }));
		} else if (targetTab === 'animate') {
			projectStore.update((p) => ({ ...p, firstFrame: state.generatedImage }));
		}

		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('designNavigate', { detail: { tab: targetTab } }));
		}
	}
</script>

<div class="h-full flex flex-col gap-2 text-sm">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-bold text-gray-800">Design</h3>
		<div class="flex items-center gap-2">
			<button class="text-[10px] text-gray-500 hover:text-blue-600" onclick={applyPreset}>Use Genesis Preset</button>
			<button class="text-[10px] text-gray-500 hover:text-red-600" onclick={resetCurrentConversation}>New Chat</button>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-2">
		<div>
			<p class="text-[10px] text-gray-500 mb-1">Generate Type</p>
			<select
				class="w-full border rounded px-2 py-1 text-xs bg-white"
				value={$designStore.contentPreset}
				onchange={(e) => updateDesignState({ contentPreset: e.target.value })}
			>
				<option value="character">Character</option>
				<option value="building">Building</option>
				<option value="item">Item</option>
				<option value="asset">Asset</option>
				<option value="scenery">Scenery</option>
				<option value="effects">Special Effects</option>
			</select>
		</div>
		<div>
			<p class="text-[10px] text-gray-500 mb-1">Theme Style</p>
			<select
				class="w-full border rounded px-2 py-1 text-xs bg-white"
				value={$designStore.stylePreset}
				onchange={(e) => updateDesignState({ stylePreset: e.target.value })}
			>
				<option value="default">Default</option>
				<option value="diablo2">Diablo II Style</option>
			</select>
		</div>
	</div>

	<div class="grid grid-cols-[1fr_auto] gap-2">
		<input class="border rounded px-2 py-1 text-xs" placeholder="Save current conversation as..." bind:value={saveName} />
		<button class="px-3 py-1 rounded bg-gray-100 text-gray-700 text-xs border" onclick={saveConversation}>Save</button>
	</div>

	<div class="grid grid-cols-[1fr_auto_auto] gap-2">
		<select class="border rounded px-2 py-1 text-xs bg-white" bind:value={selectedConversationId}>
			<option value="">Saved conversations</option>
			{#each $designStore.savedConversations as convo}
				<option value={convo.id}>{convo.name}</option>
			{/each}
		</select>
		<button class="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs border" onclick={loadConversation} disabled={!selectedConversationId}>Load</button>
		<button class="px-2 py-1 rounded bg-gray-100 text-red-600 text-xs border" onclick={deleteConversation} disabled={!selectedConversationId}>Delete</button>
	</div>

	<div class="flex gap-1 rounded-lg border p-1 bg-gray-50">
		<button
			class="flex-1 rounded px-2 py-1 text-xs font-medium {$designStore.mode === 'chat' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}"
			onclick={() => setMode('chat')}
		>
			GPT Chat
		</button>
		<button
			class="flex-1 rounded px-2 py-1 text-xs font-medium {$designStore.mode === 'genesis' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}"
			onclick={() => setMode('genesis')}
		>
			Genesis
		</button>
	</div>

	{#if $designStore.mode === 'chat'}
		<div class="rounded-lg border bg-white p-2 space-y-2">
			<div class="h-40 overflow-y-auto space-y-2 pr-1" bind:this={chatMessagesEl}>
				{#each $designStore.messages as m}
					<div class="rounded px-2 py-1 text-xs border {m.role === 'assistant' ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-gray-50 border-gray-200 text-gray-800'}">
						<strong>{m.role === 'assistant' ? 'GPT' : 'You'}:</strong> {m.content}
					</div>
				{/each}
			</div>
			{#if chatError}
				<p class="text-[11px] text-red-600">{chatError}</p>
			{/if}
			<div class="flex gap-2">
				<input
					class="flex-1 border rounded px-2 py-1 text-xs"
					placeholder="Describe your idea..."
					bind:value={userInput}
					onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendChat())}
				/>
				<button class="px-3 py-1 rounded bg-blue-500 text-white text-xs disabled:bg-gray-400" onclick={sendChat} disabled={isChatting}>
					{isChatting ? '...' : 'Send'}
				</button>
			</div>
		</div>

		<div class="rounded-lg border p-2 space-y-2">
			<p class="text-xs font-medium text-gray-700">Prompt Draft</p>
			<textarea
				class="w-full border rounded px-2 py-1 text-xs"
				rows="3"
				value={$designStore.draftPrompt}
				oninput={(e) => updateDesignState({ draftPrompt: e.target.value })}
				placeholder="Prompt generated from chat"
			></textarea>
			<button class="w-full px-3 py-2 rounded bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium disabled:bg-gray-400" onclick={usePromptInGenesis} disabled={!$designStore.draftPrompt.trim()}>
				Use This Prompt in Genesis ->
			</button>
		</div>
	{:else}
		<div class="rounded-lg border p-2 space-y-2">
			<p class="text-xs font-medium text-gray-700">Genesis Prompt</p>
			<textarea
				class="w-full border rounded px-2 py-1 text-xs"
				rows="3"
				value={$designStore.draftPrompt}
				oninput={(e) => updateDesignState({ draftPrompt: e.target.value })}
			></textarea>
			<div class="grid grid-cols-2 gap-2">
				<button class="px-2 py-2 text-xs rounded bg-gray-100 text-gray-700" onclick={() => setMode('chat')}>Back to Chat</button>
				<button class="px-2 py-2 text-xs rounded bg-blue-500 text-white disabled:bg-gray-400" onclick={generateGenesis} disabled={isGenerating || !$designStore.draftPrompt.trim()}>
					{isGenerating ? 'Generating...' : 'Generate'}
				</button>
			</div>
			{#if generationError}
				<p class="text-[11px] text-red-600">{generationError}</p>
			{/if}
		</div>

		{#if $designStore.generatedImage}
			<div class="rounded-lg border p-2 space-y-2">
				<img src={$designStore.generatedImage} alt="Genesis result" class="w-full max-h-44 object-contain rounded bg-gray-50 border" />
				<div class="grid grid-cols-3 gap-2">
					<button class="px-2 py-2 text-xs rounded border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100" onclick={() => useIn('edit')}>Use in Edit</button>
					<button class="px-2 py-2 text-xs rounded border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100" onclick={() => useIn('style')}>Use in Style</button>
					<button class="px-2 py-2 text-xs rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" onclick={() => useIn('animate')}>Use in Animate</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

