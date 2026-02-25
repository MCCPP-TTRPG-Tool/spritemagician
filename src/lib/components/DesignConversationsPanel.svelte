<script>
	import {
		designStore,
		saveCurrentConversation,
		loadSavedConversation,
		deleteSavedConversation
	} from '$lib/stores/design.js';

	let saveName = $state('');
	let selectedConversationId = $state('');
	let note = $state('');

	function closePanel() {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent('closeDesignConversationsCenter'));
	}

	function saveConversation() {
		const state = $designStore;
		if (!state.messages?.length && !state.draftPrompt?.trim()) {
			note = 'Nothing to save yet.';
			return;
		}
		const fallback = `Conversation ${new Date().toLocaleString()}`;
		saveCurrentConversation(saveName.trim() || fallback);
		saveName = '';
		note = 'Conversation saved.';
	}

	function loadConversation() {
		if (!selectedConversationId) return;
		loadSavedConversation(selectedConversationId);
		note = 'Conversation loaded.';
		closePanel();
	}

	function removeConversation() {
		if (!selectedConversationId) return;
		deleteSavedConversation(selectedConversationId);
		selectedConversationId = '';
		note = 'Conversation deleted.';
	}
</script>

<div class="h-full flex flex-col">
	<div class="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
		<p class="text-sm font-semibold text-gray-800">&#x1F4D2; Conversations</p>
		<button class="text-xs text-gray-500 hover:text-gray-700" onclick={closePanel}>&#x2715; Close</button>
	</div>
	<div class="p-3 space-y-2 overflow-y-auto">
		<div class="grid grid-cols-[1fr_auto] gap-2">
			<input class="border rounded px-2 py-1 text-xs" placeholder="Save current conversation as..." bind:value={saveName} />
			<button class="px-3 py-1 rounded bg-gray-100 text-gray-700 text-xs border" onclick={saveConversation}>&#x1F4BE; Save</button>
		</div>
		<div class="grid grid-cols-[1fr_auto_auto] gap-2">
			<select class="border rounded px-2 py-1 text-xs bg-white" bind:value={selectedConversationId}>
				<option value="">&#x1F4DA; Saved conversations</option>
				{#each $designStore.savedConversations as convo}
					<option value={convo.id}>{convo.name} · {new Date(convo.createdAt).toLocaleDateString()}</option>
				{/each}
			</select>
			<button class="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs border" onclick={loadConversation} disabled={!selectedConversationId}>&#x1F4C2; Load</button>
			<button class="px-2 py-1 rounded bg-gray-100 text-red-600 text-xs border" onclick={removeConversation} disabled={!selectedConversationId}>&#x1F5D1;&#xFE0F; Delete</button>
		</div>
		{#if note}
			<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1">{note}</p>
		{/if}
	</div>
</div>

