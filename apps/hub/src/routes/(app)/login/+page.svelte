<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useAuth } from '@pubwiki/ui/stores';
	import * as m from '$lib/paraglide/messages';

	const auth = useAuth();

	let usernameOrEmail = $state('');
	let password = $state('');
	let errorMessage = $state('');
	let isSubmitting = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		errorMessage = '';
		isSubmitting = true;

		const result = await auth.login(usernameOrEmail, password);

		if (result.success) {
			goto(resolve('/'));
		} else {
			errorMessage = result.error || m.login_failed();
		}

		isSubmitting = false;
	}
</script>

<div class="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gray-50">
	<div class="max-w-md w-full space-y-8">
		<div>
			<h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
				{m.login_title()}
			</h2>
			<p class="mt-2 text-center text-sm text-gray-600">
				{m.login_or()}
				<a href={resolve('/register')} class="font-medium text-[#0969da] hover:text-[#0969da]/80">
					{m.login_create_account()}
				</a>
			</p>
		</div>
		<form class="mt-8 space-y-6" onsubmit={handleSubmit}>
			<div class="rounded-md shadow-sm -space-y-px">
				<div>
					<label for="usernameOrEmail" class="sr-only">{m.login_username_or_email()}</label>
					<input
						id="usernameOrEmail"
						name="usernameOrEmail"
						type="text"
						required
						bind:value={usernameOrEmail}
						class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-[#0969da] focus:border-[#0969da] focus:z-10 sm:text-sm"
						placeholder={m.login_username_or_email_placeholder()}
					/>
				</div>
				<div>
					<label for="password" class="sr-only">{m.login_password()}</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						bind:value={password}
						class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-[#0969da] focus:border-[#0969da] focus:z-10 sm:text-sm"
						placeholder={m.login_password_placeholder()}
					/>
				</div>
			</div>

			{#if errorMessage}
				<div class="rounded-md bg-red-50 p-4">
					<div class="flex">
						<div class="shrink-0">
							<svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
								<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
							</svg>
						</div>
						<div class="ml-3">
							<h3 class="text-sm font-medium text-red-800">
								{errorMessage}
							</h3>
						</div>
					</div>
				</div>
			{/if}

			<div>
				<button
					type="submit"
					disabled={isSubmitting}
					class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-[#2da44e] hover:bg-[#2c974b] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2da44e] disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<span class="absolute left-0 inset-y-0 flex items-center pl-3">
						<svg class="h-5 w-5 text-[#2c974b] group-hover:text-[#2da44e]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
							<path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
						</svg>
					</span>
					{isSubmitting ? m.login_submitting() : m.login_submit()}
				</button>
			</div>
		</form>
	</div>
</div>
