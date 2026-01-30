<script lang="ts">
	import { page } from '$app/state';
	import type { DocItem } from '$lib/utils/docs';
	import Sidebar from './Sidebar.svelte';

	interface Props {
		items: DocItem[];
		depth?: number;
	}

	let { items, depth = 0 }: Props = $props();

	function isActive(slug: string): boolean {
		const currentPath = page.url.pathname;
		const itemPath = slug === 'index' ? '/' : `/${slug}`;
		return currentPath === itemPath;
	}

	function isParentActive(item: DocItem): boolean {
		const currentPath = page.url.pathname;
		const itemPath = item.slug === 'index' ? '/' : `/${item.slug}`;

		if (currentPath === itemPath) return true;
		if (item.children) {
			return item.children.some(
				(child) => currentPath === `/${child.slug}` || isParentActive(child)
			);
		}
		return false;
	}
</script>

<ul class="space-y-1 {depth > 0 ? 'ml-4 border-l border-gray-200 pl-3' : ''}">
	{#each items as item}
		{@const active = isActive(item.slug)}
		{@const parentActive = isParentActive(item)}

		<li>
			<a
				href={item.slug === 'index' ? '/' : `/${item.slug}`}
				class="block py-1.5 px-3 text-sm rounded-md transition-colors
					{active
					? 'bg-blue-50 text-[#0969da] font-medium'
					: 'text-[#57606a] hover:text-[#24292f] hover:bg-gray-100'}"
			>
				{item.title}
			</a>

			{#if item.children && item.children.length > 0 && parentActive}
				<Sidebar items={item.children} depth={depth + 1} />
			{/if}
		</li>
	{/each}
</ul>
