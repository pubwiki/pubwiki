<script lang="ts">
	import type { ArticleDetail } from '@pubwiki/api';
	import * as m from '$lib/paraglide/messages';

	type Props = {
		article: ArticleDetail;
	};

	let { article }: Props = $props();

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString();
	}
</script>

<a 
	href="/read/{article.id}"
	class="block rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-[#0969da] hover:shadow-sm group"
>
	<div class="flex items-start gap-3">
		<!-- Article Info -->
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 flex-wrap">
				<h4 class="font-semibold text-gray-900 truncate group-hover:text-[#0969da] transition-colors">
					{article.title}
				</h4>
			</div>
			
			<div class="flex items-center gap-2 mt-2 text-xs text-gray-500">
				<img 
					class="w-4 h-4 rounded-full" 
					src={article.author.avatarUrl || `https://ui-avatars.com/api/?name=${article.author.username}&background=random&size=32`} 
					alt={article.author.username} 
				/>
				<span>{article.author.displayName || article.author.username}</span>
				<span>•</span>
				<span>{formatDate(article.createdAt)}</span>
			</div>

			<div class="flex items-center gap-4 mt-3 text-xs text-gray-500">
				<span class="flex items-center gap-1">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
					</svg>
					{article.likes}
				</span>
				<span class="flex items-center gap-1">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
					</svg>
					{article.collections}
				</span>
			</div>
		</div>

		<!-- Arrow Icon -->
		<div class="shrink-0 text-gray-400 group-hover:text-[#0969da] transition-colors">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
			</svg>
		</div>
	</div>
</a>
