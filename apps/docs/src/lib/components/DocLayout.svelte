<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sidebar from './Sidebar.svelte';
	import TableOfContents from './TableOfContents.svelte';
	import { getSidebar } from '$lib/utils/docs';

	interface Props {
		title?: string;
		description?: string;
		children: Snippet;
	}

	let { title, description, children }: Props = $props();

	const sidebarItems = getSidebar();
</script>

<div class="flex min-h-[calc(100vh-64px)] pt-16">
	<!-- Sidebar -->
	<aside
		class="hidden lg:block w-[260px] shrink-0 border-r border-gray-200 bg-[#f6f8fa] overflow-y-auto sticky top-16 h-[calc(100vh-64px)]"
	>
		<nav class="p-4">
			<Sidebar items={sidebarItems} />
		</nav>
	</aside>

	<!-- Main Content -->
	<main class="flex-1 min-w-0">
		<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
			<div class="flex gap-8">
				<!-- Article -->
				<article class="flex-1 min-w-0">
					{#if title}
						<header class="mb-8">
							<h1 class="text-3xl font-bold text-[#24292f] mb-2">{title}</h1>
							{#if description}
								<p class="text-lg text-[#57606a]">{description}</p>
							{/if}
						</header>
					{/if}

					<div class="prose prose-slate max-w-none">
						{@render children()}
					</div>
				</article>

				<!-- Table of Contents - fixed position -->
				<div class="hidden xl:block w-[200px] shrink-0">
					<div class="sticky top-24">
						<TableOfContents />
					</div>
				</div>
			</div>
		</div>
	</main>
</div>
