<script lang="ts">
	import { goto } from '$app/navigation';
	import { useAuth } from '$lib/stores/auth.svelte';
	import * as m from '$lib/paraglide/messages';

	const auth = useAuth();

	let username = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let displayName = $state('');
	let errorMessage = $state('');
	let isSubmitting = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		errorMessage = '';

		if (password !== confirmPassword) {
			errorMessage = m.register_passwords_not_match();
			return;
		}

		if (password.length < 8) {
			errorMessage = m.register_password_min_length();
			return;
		}

		if (username.length < 3 || username.length > 50) {
			errorMessage = m.register_username_length();
			return;
		}

		isSubmitting = true;

		const result = await auth.register(
			username,
			email,
			password,
			displayName || undefined
		);

		if (result.success) {
			goto('/');
		} else {
			errorMessage = result.error || m.register_failed();
		}

		isSubmitting = false;
	}
</script>

<div class="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gray-50">
	<div class="max-w-md w-full space-y-8">
		<div>
			<h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
				{m.register_title()}
			</h2>
			<p class="mt-2 text-center text-sm text-gray-600">
				{m.register_or()}
				<a href="/login" class="font-medium text-[#0969da] hover:text-[#0969da]/80">
					{m.register_sign_in()}
				</a>
			</p>
		</div>
		<form class="mt-8 space-y-6" onsubmit={handleSubmit}>
			<div class="rounded-md shadow-sm -space-y-px">
				<div>
					<label for="username" class="sr-only">{m.register_username()}</label>
					<input
						id="username"
						name="username"
						type="text"
						required
						minlength={3}
						maxlength={50}
						bind:value={username}
						class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-[#0969da] focus:border-[#0969da] focus:z-10 sm:text-sm"
						placeholder={m.register_username_placeholder()}
					/>
				</div>
				<div>
					<label for="email" class="sr-only">{m.register_email()}</label>
					<input
						id="email"
						name="email"
						type="email"
						required
						bind:value={email}
						class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-[#0969da] focus:border-[#0969da] focus:z-10 sm:text-sm"
						placeholder={m.register_email_placeholder()}
					/>
				</div>
				<div>
					<label for="displayName" class="sr-only">{m.register_display_name()}</label>
					<input
						id="displayName"
						name="displayName"
						type="text"
						bind:value={displayName}
						class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-[#0969da] focus:border-[#0969da] focus:z-10 sm:text-sm"
						placeholder={m.register_display_name_placeholder()}
					/>
				</div>
				<div>
					<label for="password" class="sr-only">{m.login_password()}</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						minlength={8}
						bind:value={password}
						class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-[#0969da] focus:border-[#0969da] focus:z-10 sm:text-sm"
						placeholder={m.register_password_placeholder()}
					/>
				</div>
				<div>
					<label for="confirmPassword" class="sr-only">{m.register_confirm_password()}</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type="password"
						required
						bind:value={confirmPassword}
						class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-[#0969da] focus:border-[#0969da] focus:z-10 sm:text-sm"
						placeholder={m.register_confirm_password_placeholder()}
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
					{isSubmitting ? m.register_submitting() : m.register_submit()}
				</button>
			</div>
		</form>
	</div>
</div>
