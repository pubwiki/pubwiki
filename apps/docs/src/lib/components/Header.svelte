<script lang="ts">
	import { resolve } from '$app/paths';
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

	const navLinks: { label: string; href: `/${string}` }[] = [];
</script>

<header
	class="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-white/80 backdrop-blur-sm border-b {scrolled
		? 'border-gray-200 shadow-sm'
		: 'border-transparent'}"
>
	<div class="px-4 sm:px-6 lg:px-8">
		<div class="flex h-16 items-center justify-between">
			<!-- Logo -->
			<a href="https://pub.wiki" class="flex items-center gap-2 font-bold text-xl">
				<img src={favicon} alt="Pub.Wiki" class="h-8 w-8" />
				<span class="text-[#24292f]">Pub.Wiki</span>
				<span class="text-[#57606a] font-normal text-sm">Docs</span>
			</a>

			<!-- Desktop Navigation -->
			<nav class="hidden md:flex items-center gap-8">
				{#each navLinks as link (link.href)}
					<a
						href={resolve(link.href)}
						class="text-sm font-medium text-[#57606a] hover:text-[#0969da] transition-colors"
					>
						{link.label}
					</a>
				{/each}
			</nav>

			<!-- Mobile Menu Button -->
			<button
				class="md:hidden p-2 text-[#57606a] hover:text-[#0969da]"
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
					{#each navLinks as link (link.href)}
						<a
							href={resolve(link.href)}
							class="text-sm font-medium text-[#57606a] hover:text-[#0969da] transition-colors"
							onclick={() => (mobileMenuOpen = false)}
						>
							{link.label}
						</a>
					{/each}
				</nav>
			</div>
		{/if}
	</div>
</header>
