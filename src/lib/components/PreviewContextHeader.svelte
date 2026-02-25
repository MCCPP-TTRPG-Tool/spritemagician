<script>
	let {
		enabled = true,
		chipLabel = 'Preview',
		sourceLabel = 'Source unavailable',
		modelLabel = null,
		timestampLabel = '',
		actionSafetyLine = '',
		canReset = false,
		onResetContext = () => {}
	} = $props();
</script>

{#if enabled}
	<div class="mx-2 mt-2 mb-1 rounded-lg border border-blue-100 bg-blue-50/70 px-2 py-1.5">
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<span class="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
						{chipLabel}
					</span>
					{#if modelLabel}
						<span class="text-[10px] text-blue-700 truncate">{modelLabel}</span>
					{/if}
					{#if timestampLabel}
						<span class="text-[10px] text-blue-600/80">{timestampLabel}</span>
					{/if}
				</div>
				<p class="mt-1 truncate text-[10px] text-gray-600">Source: {sourceLabel}</p>
				{#if actionSafetyLine}
					<p class="mt-0.5 text-[10px] font-medium text-gray-700 truncate">{actionSafetyLine}</p>
				{/if}
			</div>

			<button
				class="shrink-0 rounded border border-blue-200 bg-white px-2 py-0.5 text-[10px] text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
				onclick={onResetContext}
				disabled={!canReset}
				title="Reset temporary preview override"
			>
				Reset Context
			</button>
		</div>
	</div>
{/if}

