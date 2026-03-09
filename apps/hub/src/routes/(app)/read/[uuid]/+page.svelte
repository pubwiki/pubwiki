<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { ArticleDetail, GameRef } from '@pubwiki/api';
	import { Reader, type ReaderContent, extractToc } from '@pubwiki/reader';
	import { useArticleStore } from '$lib/stores/articles.svelte';
	import { PUBLIC_STUDIO_URL, PUBLIC_PLAY_URL } from '$env/static/public';
	import * as m from '$lib/paraglide/messages';

	const studioUrl = PUBLIC_STUDIO_URL || 'http://localhost:5174';
	const playUrl = PUBLIC_PLAY_URL || 'http://localhost:5175';

	const articleStore = useArticleStore();
	
	// Article state - use Promise to prevent re-fetch on empty result
	let article = $state<ArticleDetail | null>(null);
	let articlePromise = $state<Promise<ArticleDetail | null> | null>(null);
	let lastArticleId = $state<string | null>(null);
	let articleError = $state<string | null>(null);

	let progress = $state(0);
	let tocOpen = $state(false);
	let settingsOpen = $state(false);

	// Reader settings
	type ThemeMode = 'light' | 'dark' | 'sepia';
	type FontFamily = 'serif' | 'sans-serif' | 'kai';

	let theme = $state<ThemeMode>('light');
	let fontFamily = $state<FontFamily>('serif');
	let fontSize = $state(18); // in pixels

	const fontFamilyOptions: { value: FontFamily; label: string }[] = [
		{ value: 'serif', label: '宋体' },
		{ value: 'sans-serif', label: '黑体' },
		{ value: 'kai', label: '楷体' },
	];

	const themeOptions: { value: ThemeMode; label: string }[] = [
		{ value: 'light', label: '白天' },
		{ value: 'sepia', label: '护眼' },
		{ value: 'dark', label: '夜间' },
	];

	function toggleSettings() {
		settingsOpen = !settingsOpen;
		if (settingsOpen) tocOpen = false;
	}

	function handleScroll() {
		const scrollTop = window.scrollY;
		const docHeight = document.documentElement.scrollHeight - window.innerHeight;
		if (docHeight > 0) {
			progress = Math.min(100, Math.round((scrollTop / docHeight) * 100));
		}
	}

	onMount(() => {
		window.addEventListener('scroll', handleScroll, { passive: true });
		handleScroll(); // Initial calculation
		return () => window.removeEventListener('scroll', handleScroll);
	});

	// Fetch article data when articleId changes
	$effect(() => {
		const articleId = page.params.uuid;
		if (articleId && articleId !== lastArticleId) {
			lastArticleId = articleId;
			article = null;
			articleError = null;
			articlePromise = articleStore.fetchArticle(articleId).then(result => {
				article = result;
				if (!result) articleError = 'Article not found';
				return result;
			}).catch(e => {
				articleError = e instanceof Error ? e.message : 'Article not found';
				return null;
			});
		}
	});

	// Derive content and toc from article
	let content = $derived<ReaderContent>(article?.content ?? []);
	let tocItems = $derived(extractToc(content));

	function toggleToc() {
		tocOpen = !tocOpen;
		if (tocOpen) settingsOpen = false;
	}

	function scrollToHeading(id: string) {
		// Find the heading element by searching for its text content
		const headings = document.querySelectorAll('.reader-h1, .reader-h2, .reader-h3');
		const tocItem = tocItems.find(item => item.id === id);
		if (!tocItem) return;

		for (const heading of headings) {
			if (heading.textContent === tocItem.title) {
				const rect = heading.getBoundingClientRect();
				const scrollTop = window.scrollY + rect.top - 80; // 80px offset for header
				window.scrollTo({ top: scrollTop, behavior: 'smooth' });
				tocOpen = false;
				break;
			}
		}
	}
</script>

{#if articlePromise}
	{#await articlePromise}
		<div class="reader-page theme-light">
			<div class="min-h-screen bg-[#faf9f7] flex items-center justify-center">
				<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0969da]"></div>
			</div>
		</div>
	{:then}
		{#if articleError || !article}
			<div class="reader-page theme-light">
				<div class="min-h-screen bg-[#faf9f7] flex items-center justify-center">
					<div class="text-center">
						<h1 class="text-2xl font-bold text-gray-900 mb-2">{m.artifact_not_found()}</h1>
						<p class="text-gray-600 mb-4">{articleError || m.artifact_not_found_message()}</p>
						<button onclick={() => goto('/')} class="text-[#0969da] hover:underline">
							{m.artifact_go_back()}
						</button>
					</div>
				</div>
			</div>
		{:else}
			<div class="reader-page theme-{theme}">
		<header class="reader-header">
			<a href="/" class="back-button">
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M19 12H5M12 19l-7-7 7-7"/>
				</svg>
				返回
			</a>
			<div class="title-area">
				<h1>{article.title}</h1>
				<span class="subtitle">{article.author.displayName || article.author.username}</span>
			</div>
		<div class="header-actions">
			<!-- TOC Dropdown -->
			<div class="dropdown-wrapper">
				<button class="action-btn" class:active={tocOpen} title="目录" onclick={toggleToc}>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
					</svg>
				</button>
				{#if tocOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
					<div class="dropdown toc-dropdown" onclick={(e) => e.stopPropagation()} role="presentation">
						<div class="dropdown-header">目录</div>
						<nav class="toc-list">
							{#each tocItems as item}
								<button 
									class="toc-item level-{item.level}" 
									onclick={() => scrollToHeading(item.id)}
								>
									{item.title}
								</button>
							{/each}
						</nav>
					</div>
				{/if}
			</div>

			<!-- Settings Dropdown -->
			<div class="dropdown-wrapper">
				<button class="action-btn" class:active={settingsOpen} title="设置" onclick={toggleSettings}>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</button>
				{#if settingsOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
					<div class="dropdown settings-dropdown" onclick={(e) => e.stopPropagation()} role="presentation">
						<div class="dropdown-header">阅读设置</div>
						<div class="settings-content">
							<!-- Theme Mode -->
							<div class="setting-group">
								<span class="setting-label">主题模式</span>
								<div class="theme-options" role="group" aria-label="主题模式">
									{#each themeOptions as opt}
										<button 
											class="theme-btn theme-btn-{opt.value}" 
											class:active={theme === opt.value}
											onclick={() => theme = opt.value}
										>
											{opt.label}
										</button>
									{/each}
								</div>
							</div>

							<!-- Font Family -->
							<div class="setting-group">
								<span class="setting-label">字体</span>
								<div class="font-options" role="group" aria-label="字体">
									{#each fontFamilyOptions as opt}
										<button 
											class="font-btn font-btn-{opt.value}" 
											class:active={fontFamily === opt.value}
											onclick={() => fontFamily = opt.value}
										>
											{opt.label}
										</button>
									{/each}
								</div>
							</div>

							<!-- Font Size -->
							<div class="setting-group">
								<span class="setting-label">字号 <span class="font-size-value">{fontSize}px</span></span>
								<div class="font-size-control" role="group" aria-label="字号">
									<button 
										class="size-btn" 
										onclick={() => fontSize = Math.max(12, fontSize - 2)}
										disabled={fontSize <= 12}
										aria-label="减小字号"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<line x1="5" y1="12" x2="19" y2="12"/>
										</svg>
									</button>
									<input 
										type="range" 
										min="12" 
										max="28" 
										step="2" 
										bind:value={fontSize}
										class="size-slider"
									/>
									<button 
										class="size-btn" 
										onclick={() => fontSize = Math.min(28, fontSize + 2)}
										disabled={fontSize >= 28}
										aria-label="增大字号"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
										</svg>
									</button>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<!-- Overlay for dropdowns -->
	{#if tocOpen || settingsOpen}
		<div class="dropdown-overlay" onclick={() => { tocOpen = false; settingsOpen = false; }} role="presentation"></div>
	{/if}

	<main 
		class="reader-content"
		style="--reader-font-size: {fontSize}px; --reader-font-family: var(--reader-font-{fontFamily});"
	>
		<Reader 
			content={content} 
			buildPlaybackUrl={(gameRef: GameRef) => `${playUrl}/${article!.artifactId}/play?save=${gameRef.saveCommit}`}
		/>
	</main>

	<footer class="reader-footer">
		<div class="progress-info">
			<span class="progress-text">阅读进度</span>
			<div class="progress-bar">
				<div class="progress-fill" style="width: {progress}%"></div>
			</div>
			<span class="progress-percent">{progress}%</span>
		</div>
	</footer>
</div>
		{/if}
	{:catch}
		<div class="reader-page theme-light">
			<div class="min-h-screen bg-[#faf9f7] flex items-center justify-center">
				<div class="text-center">
					<h1 class="text-2xl font-bold text-gray-900 mb-2">{m.artifact_not_found()}</h1>
					<p class="text-gray-600 mb-4">{m.artifact_not_found_message()}</p>
					<button onclick={() => goto('/')} class="text-[#0969da] hover:underline">
						{m.artifact_go_back()}
					</button>
				</div>
			</div>
		</div>
	{/await}
{:else}
	<div class="reader-page theme-light">
		<div class="min-h-screen bg-[#faf9f7] flex items-center justify-center">
			<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0969da]"></div>
		</div>
	</div>
{/if}

<style>
	.reader-page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background-color: #faf9f7;
	}

	.reader-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1.5rem;
		background-color: #ffffff;
		border-bottom: 1px solid #e5e5e5;
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.back-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #666;
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.2s;
	}

	.back-button:hover {
		color: #333;
	}

	.title-area {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
	}

	.title-area h1 {
		font-size: 1rem;
		font-weight: 600;
		color: #333;
		margin: 0;
	}

	.title-area .subtitle {
		font-size: 0.75rem;
		color: #888;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		position: relative;
	}

	.dropdown-wrapper {
		position: relative;
		z-index: 200;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		background: transparent;
		border-radius: 8px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.action-btn:hover {
		background-color: var(--item-hover-bg, #f0f0f0);
		color: var(--text-color);
	}

	.reader-content {
		flex: 1;
		max-width: 720px;
		width: 100%;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.reader-footer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 0.75rem 1.5rem;
		background: linear-gradient(transparent, #faf9f7 30%);
	}

	.progress-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: 720px;
		margin: 0 auto;
	}

	.progress-text {
		font-size: 0.75rem;
		color: #888;
		white-space: nowrap;
	}

	.progress-bar {
		flex: 1;
		height: 4px;
		background-color: #e5e5e5;
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background-color: var(--color-accent, #0969da);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.progress-percent {
		font-size: 0.75rem;
		color: #666;
		font-weight: 500;
		min-width: 2.5rem;
		text-align: right;
	}

	/* Action Button Active State */
	.action-btn.active {
		background-color: var(--control-active-bg, #e8f0fe);
		color: var(--color-accent, #0969da);
	}

	/* Dropdown Overlay */
	.dropdown-overlay {
		position: fixed;
		top: 60px; /* Below header */
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 99;
	}

	/* Dropdown Base */
	.dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		background-color: var(--dropdown-bg, #ffffff);
		border-radius: 12px;
		box-shadow: 0 4px 24px var(--dropdown-shadow, rgba(0, 0, 0, 0.12)), 0 0 0 1px var(--dropdown-border, rgba(0, 0, 0, 0.05));
		z-index: 200;
		animation: dropdownIn 0.15s ease;
	}

	@keyframes dropdownIn {
		from { opacity: 0; transform: translateY(-8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.dropdown-header {
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border-color);
	}

	/* TOC Dropdown */
	.toc-dropdown {
		width: 280px;
		max-height: 400px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.toc-list {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 0;
	}

	.toc-item {
		display: block;
		width: 100%;
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		text-align: left;
		font-size: 0.875rem;
		color: var(--text-color);
		cursor: pointer;
		transition: all 0.15s;
		line-height: 1.4;
	}

	.toc-item:hover {
		background-color: var(--item-hover-bg, #f5f5f5);
		color: var(--color-accent, #0969da);
	}

	.toc-item.level-1 {
		font-weight: 600;
		color: var(--text-color);
	}

	.toc-item.level-2 {
		padding-left: 1.75rem;
		font-size: 0.8125rem;
	}

	.toc-item.level-3 {
		padding-left: 2.5rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	/* Settings Dropdown */
	.settings-dropdown {
		width: 280px;
	}

	.settings-content {
		padding: 0.75rem 1rem 1rem;
	}

	.setting-group {
		margin-bottom: 1rem;
	}

	.setting-group:last-child {
		margin-bottom: 0;
	}

	.setting-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.font-size-value {
		font-weight: 400;
		color: var(--text-secondary);
	}

	/* Theme options - styled to match their themes */
	.theme-options {
		display: flex;
		gap: 0.375rem;
	}

	.theme-btn {
		flex: 1;
		padding: 0.5rem 0.625rem;
		border: 2px solid transparent;
		border-radius: 6px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	/* Light theme button */
	.theme-btn-light {
		background: #faf9f7;
		color: #333;
		border-color: #e5e5e5;
	}

	.theme-btn-light:hover {
		border-color: #ccc;
	}

	.theme-btn-light.active {
		border-color: #333;
	}

	/* Sepia theme button */
	.theme-btn-sepia {
		background: #f4ecd8;
		color: #5b4636;
		border-color: #d4c4a8;
	}

	.theme-btn-sepia:hover {
		border-color: #b8a88c;
	}

	.theme-btn-sepia.active {
		border-color: #5b4636;
	}

	/* Dark theme button */
	.theme-btn-dark {
		background: #1a1a1a;
		color: #e0e0e0;
		border-color: #333;
	}

	.theme-btn-dark:hover {
		border-color: #555;
	}

	.theme-btn-dark.active {
		border-color: #e0e0e0;
	}

	/* Font options - styled with their fonts */
	.font-options {
		display: flex;
		gap: 0.375rem;
	}

	.font-btn {
		flex: 1;
		padding: 0.5rem 0.5rem;
		border: 1px solid var(--border-color);
		background: var(--control-bg, #fafafa);
		border-radius: 6px;
		font-size: 0.8125rem;
		color: var(--text-color);
		cursor: pointer;
		transition: all 0.15s;
	}

	.font-btn:hover {
		border-color: var(--control-hover-border, #ccc);
		background: var(--control-hover-bg, #f5f5f5);
	}

	.font-btn.active {
		border-color: var(--color-accent, #0969da);
		background: var(--control-active-bg, #e8f0fe);
		color: var(--color-accent, #0969da);
	}

	/* Apply actual fonts to font buttons */
	.font-btn-serif {
		font-family: 'Noto Serif SC', 'Songti SC', Georgia, serif;
	}

	.font-btn-sans-serif {
		font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
	}

	.font-btn-kai {
		font-family: 'LXGW WenKai', 'KaiTi', 'STKaiti', serif;
	}

	/* Font size control */
	.font-size-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.size-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--border-color);
		background: var(--control-bg, #fafafa);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.size-btn:hover:not(:disabled) {
		border-color: var(--control-hover-border, #ccc);
		background: var(--control-hover-bg, #f0f0f0);
		color: var(--text-color);
	}

	.size-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.size-slider {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--border-color);
		border-radius: 2px;
		outline: none;
	}

	.size-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		background: #0969da;
		border-radius: 50%;
		cursor: pointer;
		transition: transform 0.15s;
	}

	.size-slider::-webkit-slider-thumb:hover {
		transform: scale(1.1);
	}

	.size-slider::-moz-range-thumb {
		width: 14px;
		height: 14px;
		background: #0969da;
		border: none;
		border-radius: 50%;
		cursor: pointer;
	}

	/* Font family CSS variables */
	.reader-page {
		--reader-font-serif: 'Noto Serif SC', 'Source Han Serif CN', 'Songti SC', Georgia, 'Times New Roman', serif;
		--reader-font-sans-serif: 'Noto Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif;
		--reader-font-kai: 'LXGW WenKai', 'KaiTi', 'STKaiti', 'AR PL UKai CN', serif;
	}

	/* Theme styles */
	.reader-page.theme-light {
		--page-bg: #faf9f7;
		--header-bg: #ffffff;
		--text-color: #333;
		--text-secondary: #666;
		--border-color: #e5e5e5;
		--dropdown-bg: #ffffff;
		--dropdown-shadow: rgba(0, 0, 0, 0.12);
		--dropdown-border: rgba(0, 0, 0, 0.05);
		--item-hover-bg: #f5f5f5;
		--control-bg: #fafafa;
		--control-hover-bg: #f0f0f0;
		--control-hover-border: #ccc;
		--control-active-bg: #e8f0fe;
		--color-accent: #0969da;
	}

	.reader-page.theme-sepia {
		--page-bg: #f4ecd8;
		--header-bg: #f9f3e3;
		--text-color: #5b4636;
		--text-secondary: #8b7355;
		--border-color: #d4c4a8;
		--dropdown-bg: #f9f3e3;
		--dropdown-shadow: rgba(91, 70, 54, 0.15);
		--dropdown-border: rgba(91, 70, 54, 0.1);
		--item-hover-bg: #f0e6d0;
		--control-bg: #f4ecd8;
		--control-hover-bg: #ede3c8;
		--control-hover-border: #b8a88c;
		--control-active-bg: #e8dfc8;
		--color-accent: #8b5a2b;
	}

	.reader-page.theme-dark {
		--page-bg: #1a1a1a;
		--header-bg: #242424;
		--text-color: #e0e0e0;
		--text-secondary: #999;
		--border-color: #444;
		--dropdown-bg: #2a2a2a;
		--dropdown-shadow: rgba(0, 0, 0, 0.4);
		--dropdown-border: rgba(255, 255, 255, 0.1);
		--item-hover-bg: #383838;
		--control-bg: #333;
		--control-hover-bg: #444;
		--control-hover-border: #555;
		--control-active-bg: #1a3a5c;
		--color-accent: #58a6ff;
	}

	/* Apply theme variables */
	.reader-page {
		background-color: var(--page-bg);
		color: var(--text-color);
		transition: background-color 0.3s, color 0.3s;
	}

	.reader-page .reader-header {
		background-color: var(--header-bg);
		border-bottom-color: var(--border-color);
	}

	.reader-page .back-button,
	.reader-page .action-btn {
		color: var(--text-secondary);
	}

	.reader-page .title-area h1 {
		color: var(--text-color);
	}

	.reader-page .title-area .subtitle {
		color: var(--text-secondary);
	}

	.reader-page .progress-text {
		color: var(--text-secondary);
	}

	.reader-page .progress-bar {
		background-color: var(--border-color);
	}

	.reader-page .progress-percent {
		color: var(--text-secondary);
	}

	.reader-page .reader-footer {
		background: linear-gradient(transparent, var(--page-bg) 30%);
	}

	/* Reader content theme application */
	.reader-content {
		--reader-text-color: var(--text-color);
		--reader-heading-color: var(--text-color);
		--reader-border-color: var(--border-color);
		--reader-button-border: var(--border-color);
		--reader-button-color: var(--text-secondary);
		--reader-button-hover-bg: rgba(128, 128, 128, 0.1);
		--reader-button-hover-color: var(--text-color);
	}

</style>
