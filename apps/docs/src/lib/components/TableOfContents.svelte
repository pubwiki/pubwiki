<script lang="ts">

	interface TOCItem {
		id: string;
		text: string;
		level: number;
	}

	let tocItems = $state<TOCItem[]>([]);
	let activeId = $state<string | null>(null);

	$effect(() => {
		// Extract headings from the document
		const headings = document.querySelectorAll('.prose h2, .prose h3');
		const items: TOCItem[] = [];

		headings.forEach((heading) => {
			const id = heading.id;
			const text = heading.textContent?.replace('#', '').trim() || '';
			const level = heading.tagName === 'H2' ? 2 : 3;

			if (id && text) {
				items.push({ id, text, level });
			}
		});

		tocItems = items;

		// Setup intersection observer for active heading
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						activeId = entry.target.id;
					}
				});
			},
			{
				rootMargin: '-80px 0px -80% 0px'
			}
		);

		headings.forEach((heading) => {
			if (heading.id) {
				observer.observe(heading);
			}
		});

		return () => observer.disconnect();
	});
</script>

{#if tocItems.length > 0}
	<nav class="w-full">
		<h4 class="text-sm font-semibold text-[#24292f] mb-3">On this page</h4>
		<ul class="space-y-2 text-sm">
			{#each tocItems as item (item.id)}
				<li class="{item.level === 3 ? 'ml-3' : ''}">
					<a
						href="#{item.id}"
						class="block py-1 transition-colors
							{activeId === item.id
							? 'text-[#0969da] font-medium'
							: 'text-[#57606a] hover:text-[#24292f]'}"
					>
						{item.text}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
{/if}
