<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let scrolled = $state(false);
	let mobileMenuOpen = $state(false);

	$effect(() => {
		const handleScroll = () => {
			scrolled = window.scrollY > 20;
		};
		window.addEventListener('scroll', handleScroll);
		return () => window.removeEventListener('scroll', handleScroll);
	});

	const navLinks = [
		{ label: 'Features', href: '#features' },
		{ label: 'How It Works', href: '#how-it-works' },
		{ label: 'Showcase', href: '#showcase' },
		{ label: 'Docs', href: '/docs' }
	];
</script>

<header
	class="fixed top-0 left-0 right-0 z-50 transition-all duration-300 {scrolled
		? 'glass shadow-lg'
		: 'bg-transparent'}"
>
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="flex h-16 items-center justify-between">
			<!-- Logo -->
			<a href="/" class="flex items-center gap-2 font-bold text-xl">
				<img src={favicon} alt="Pub.Wiki" class="h-8 w-8" />
				<span class="text-[#24292f]">Pub.Wiki</span>
			</a>

			<!-- Desktop Navigation -->
			<nav class="hidden md:flex items-center gap-8">
				{#each navLinks as link}
					<a
						href={link.href}
						class="text-sm font-medium text-[#57606a] hover:text-[var(--color-primary)] transition-colors"
					>
						{link.label}
					</a>
				{/each}
			</nav>

			<!-- CTA Buttons -->
			<div class="hidden md:flex items-center gap-3">
				<a
					href="https://hub.pub.wiki"
					class="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
				>
					Sign In
				</a>
				<a
					href="https://studio.pub.wiki"
					class="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
				>
					Launch Studio
				</a>
			</div>

			<!-- Mobile Menu Button -->
			<button
				class="md:hidden p-2 text-[#57606a] hover:text-[var(--color-primary)]"
				onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					{#if mobileMenuOpen}
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					{:else}
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						/>
					{/if}
				</svg>
			</button>
		</div>

		<!-- Mobile Menu -->
		{#if mobileMenuOpen}
			<div class="md:hidden py-4 border-t border-gray-200">
				<nav class="flex flex-col gap-4">
					{#each navLinks as link}
						<a
							href={link.href}
							class="text-sm font-medium text-slate-600 hover:text-slate-900"
							onclick={() => (mobileMenuOpen = false)}
						>
							{link.label}
						</a>
					{/each}
					<div class="pt-4 border-t border-gray-200 flex flex-col gap-3">
						<a href="https://hub.pub.wiki" class="text-sm font-medium text-slate-600"> Sign In </a>
						<a
							href="https://studio.pub.wiki"
							class="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
						>
							Launch Studio
						</a>
					</div>
				</nav>
			</div>
		{/if}
	</div>
</header>
