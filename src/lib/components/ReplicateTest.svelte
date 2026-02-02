<script>
	let testResult = $state(null);
	let isLoading = $state(false);
	let error = $state(null);
	
	async function testConnection() {
		isLoading = true;
		error = null;
		testResult = null;
		
		try {
			const response = await fetch('/api/test-replicate');
			const data = await response.json();
			
			if (!response.ok) {
				throw new Error(data.error || 'Test failed');
			}
			
			testResult = data;
		} catch (e) {
			error = e.message;
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="bg-gray-800 rounded-lg p-4 text-white text-sm">
	<h3 class="font-bold mb-3">Replicate API Test</h3>
	
	<button
		class="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded disabled:bg-gray-600"
		onclick={testConnection}
		disabled={isLoading}
	>
		{isLoading ? 'Testing...' : 'Test Replicate Connection'}
	</button>
	
	{#if error}
		<div class="mt-3 p-2 bg-red-900 rounded text-red-200 text-xs">
			❌ {error}
		</div>
	{/if}
	
	{#if testResult}
		<div class="mt-3 space-y-2">
			<div class="flex items-center gap-2">
				<span class={testResult.apiConnected ? 'text-green-400' : 'text-red-400'}>
					{testResult.apiConnected ? '✓' : '✗'}
				</span>
				<span>API Connected</span>
			</div>
			
			{#if testResult.models}
				<div class="text-xs space-y-1">
					<div class="text-gray-400 font-medium">Models:</div>
					{#each Object.entries(testResult.models) as [name, info]}
						<div class="flex items-center gap-2 pl-2">
							<span class={info.available ? 'text-green-400' : 'text-red-400'}>
								{info.available ? '✓' : '✗'}
							</span>
							<span class="font-mono">{name}</span>
							{#if info.available}
								<span class="text-gray-500">- {info.name}</span>
							{:else}
								<span class="text-red-400">- {info.error}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

