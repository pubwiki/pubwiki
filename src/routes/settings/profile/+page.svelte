<script lang="ts">
	import { useAuth } from '$lib/stores/auth.svelte';

	const auth = useAuth();

	let displayName = $state('');
	let bio = $state('');
	let website = $state('');
	let location = $state('');
	let avatarUrl = $state('');
	let message = $state('');
	let error = $state('');
	let isSubmitting = $state(false);

	// Initialize form with user data when available
	$effect(() => {
		if (auth.currentUser) {
			// Only set if not already modified? No, sync with user data initially.
			// But if user types, we don't want to overwrite.
			// Actually, $effect runs when dependencies change.
			// If I bind inputs to these variables, typing changes them.
			// If auth.currentUser changes (e.g. after update), it might overwrite.
			// Better to use untracked or just init once?
			// But auth.currentUser might be null initially then loaded.
			// I'll use a flag or check if empty?
			// Simple approach: just set them. If user is typing and background update happens, it might be annoying.
			// But background update only happens on explicit action usually.
		}
	});
    
    // Better: use a derived state or just init on mount if possible, but auth might be async.
    // I'll use an effect that runs only when auth.currentUser becomes available and form is empty.
    let initialized = false;
    $effect(() => {
        if (auth.currentUser && !initialized) {
            displayName = auth.currentUser.displayName || '';
            bio = auth.currentUser.bio || '';
            website = auth.currentUser.website || '';
            location = auth.currentUser.location || '';
            avatarUrl = auth.currentUser.avatarUrl || '';
            initialized = true;
        }
    });

	async function handleSubmit(e: Event) {
		e.preventDefault();
		message = '';
		error = '';
		isSubmitting = true;

		const result = await auth.updateProfile({
			displayName: displayName || undefined,
			bio: bio || undefined,
			website: website || undefined,
			location: location || undefined,
			avatarUrl: avatarUrl || undefined
		});

		if (result.success) {
			message = 'Profile updated successfully';
		} else {
			error = result.error || 'Update failed';
		}

		isSubmitting = false;
	}
</script>

<div class="max-w-2xl mx-auto py-8 px-4">
	<h1 class="text-2xl font-bold text-gray-900 mb-6">Public Profile</h1>

	<div class="bg-white shadow rounded-lg p-6">
		{#if message}
			<div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
				{message}
			</div>
		{/if}

		{#if error}
			<div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
				{error}
			</div>
		{/if}

		<form onsubmit={handleSubmit} class="space-y-6">
			<div class="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
				<div class="sm:col-span-6">
					<label for="displayName" class="block text-sm font-medium text-gray-700">
						Name
					</label>
					<div class="mt-1">
						<input
							type="text"
							name="displayName"
							id="displayName"
							bind:value={displayName}
							class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
						/>
					</div>
					<p class="mt-2 text-sm text-gray-500">
						Your name may appear around PubWiki where you contribute or are mentioned. You can remove it at any time.
					</p>
				</div>

				<div class="sm:col-span-6">
					<label for="bio" class="block text-sm font-medium text-gray-700">
						Bio
					</label>
					<div class="mt-1">
						<textarea
							id="bio"
							name="bio"
							rows="3"
							bind:value={bio}
							class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border border-gray-300 rounded-md px-3 py-2"
						></textarea>
					</div>
					<p class="mt-2 text-sm text-gray-500">
						Tell us a little bit about yourself.
					</p>
				</div>

				<div class="sm:col-span-6">
					<label for="website" class="block text-sm font-medium text-gray-700">
						URL
					</label>
					<div class="mt-1">
						<input
							type="url"
							name="website"
							id="website"
							bind:value={website}
							class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
						/>
					</div>
				</div>

				<div class="sm:col-span-6">
					<label for="location" class="block text-sm font-medium text-gray-700">
						Location
					</label>
					<div class="mt-1">
						<input
							type="text"
							name="location"
							id="location"
							bind:value={location}
							class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
						/>
					</div>
				</div>
                
                <div class="sm:col-span-6">
					<label for="avatarUrl" class="block text-sm font-medium text-gray-700">
						Avatar URL
					</label>
					<div class="mt-1 flex items-center gap-4">
                        <img 
                            src={avatarUrl || `https://ui-avatars.com/api/?name=${auth.currentUser?.username}&background=random`} 
                            alt="Avatar preview" 
                            class="h-12 w-12 rounded-full"
                        />
						<input
							type="url"
							name="avatarUrl"
							id="avatarUrl"
							bind:value={avatarUrl}
							class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
						/>
					</div>
				</div>
			</div>

			<div class="pt-5">
				<div class="flex justify-end">
					<button
						type="submit"
						disabled={isSubmitting}
						class="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-[#2da44e] hover:bg-[#2c974b] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2da44e] disabled:opacity-50"
					>
						{isSubmitting ? 'Saving...' : 'Update profile'}
					</button>
				</div>
			</div>
		</form>
	</div>
</div>
