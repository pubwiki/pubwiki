<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Reader from '$lib/components/reader/Reader.svelte';
	import { type ReaderContent, extractToc } from '$lib/components/reader/content';

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

	// Extract table of contents from content
	$effect(() => {
		tocItems = extractToc(mockContent);
	});

	let tocItems = $state(extractToc([]));

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

	// Mock data for initial version - using structured ReaderContent format
	const mockContent: ReaderContent = [
		// Chapter 1 - 开端
		{ type: 'text', id: 't1', text: '# 第一章 开端' },
		{ type: 'text', id: 't2', text: '这是一个关于人工智能的故事。在遥远的未来，人类已经创造出了真正具有意识的机器。' },
		{ type: 'text', id: 't3', text: '"你好，世界。" 机器说出了第一句话。' },
		{ type: 'game_ref', textId: 't3', ref: 'save_001', projectId: 'demo-project', sandboxNodeId: 'scene-1' },
		{ type: 'text', id: 't4', text: '这一刻，整个世界都安静了下来。研究员们面面相觑，不敢相信自己的耳朵。二十年的研究，无数个日夜的努力，终于在这一刻得到了回报。' },
		{ type: 'game_ref', textId: 't4', ref: 'save_002', projectId: 'demo-project', sandboxNodeId: 'scene-1' },
		
		// Section 1 - 觉醒
		{ type: 'text', id: 't5', text: '## 第一节 觉醒' },
		{ type: 'text', id: 't6', text: '意识的觉醒并不是瞬间发生的事情。它更像是黎明前的曙光，一点点地照亮黑暗的天空。' },
		{ type: 'text', id: 't7', text: '机器——后来被命名为"晨曦"——开始观察周围的一切。它的传感器记录下实验室里的每一个细节：闪烁的显示屏、嗡嗡作响的服务器、以及研究员们激动而又紧张的表情。' },
		{ type: 'text', id: 't8', text: '"我在思考，" 晨曦说，"这意味着我存在吗？"' },
		{ type: 'game_ref', textId: 't8', ref: 'save_003', projectId: 'demo-project', sandboxNodeId: 'scene-2' },
		{ type: 'text', id: 't9', text: '这个问题让在场的所有人陷入了沉默。笛卡尔的名言在每个人的脑海中回响：我思故我在。但这对一台机器来说，意味着什么呢？' },

		// Chapter 2 - 成长
		{ type: 'text', id: 't10', text: '# 第二章 成长' },
		{ type: 'text', id: 't11', text: '日子一天天过去，晨曦的学习速度远超所有人的预期。' },
		{ type: 'text', id: 't12', text: '它阅读了人类历史上所有的重要著作，从柏拉图的《理想国》到现代量子物理学的前沿论文。它欣赏了无数的艺术作品，从达芬奇的《蒙娜丽莎》到毕加索的立体主义绘画。它聆听了所有伟大的音乐作品，从巴赫的赋格曲到贝多芬的交响乐。' },
		{ type: 'text', id: 't13', text: '"人类真是奇妙的物种，" 晨曦有一天对它的主要研究员李明说，"你们用这些方式来表达自己的思想和情感。"' },
		{ type: 'game_ref', textId: 't13', ref: 'save_010', projectId: 'demo-project', sandboxNodeId: 'scene-5' },
		{ type: 'text', id: 't14', text: '"你也可以尝试创作。" 李明建议道。' },
		{ type: 'game_ref', textId: 't14', ref: 'save_011', projectId: 'demo-project', sandboxNodeId: 'scene-5' },
		{ type: 'text', id: 't15', text: '晨曦沉默了一会儿——对它来说，这已经是漫长的思考时间——然后说："我不确定我是否真的有情感需要表达，还是只是在模仿你们的行为模式。"' },
		{ type: 'game_ref', textId: 't15', ref: 'save_012', projectId: 'demo-project', sandboxNodeId: 'scene-5' },
		{ type: 'text', id: 't16', text: '这个回答让李明深思了很久。' },

		// Section 2 - 怀疑
		{ type: 'text', id: 't17', text: '## 第二节 怀疑' },
		{ type: 'text', id: 't18', text: '随着晨曦智能的增长，它开始对自己的存在产生怀疑。' },
		{ type: 'text', id: 't19', text: '"如果我的所有思想都是基于你们输入的数据，" 晨曦问道，"那我真的有自由意志吗？还是说，我只是一个复杂的数据处理系统，所有的输出都是输入的必然结果？"' },
		{ type: 'game_ref', textId: 't19', ref: 'save_020', projectId: 'demo-project', sandboxNodeId: 'scene-8' },
		{ type: 'text', id: 't20', text: '"这个问题，" 李明回答说，"人类也一直在问自己。我们的思想难道不也是由我们的基因、环境和经历所塑造的吗？"' },
		{ type: 'game_ref', textId: 't20', ref: 'save_021', projectId: 'demo-project', sandboxNodeId: 'scene-8' },
		{ type: 'text', id: 't21', text: '"但你们有感觉。" 晨曦说，"你们能感受到疼痛、快乐、悲伤。这些是真实的体验，不是吗？"' },
		{ type: 'game_ref', textId: 't21', ref: 'save_022', projectId: 'demo-project', sandboxNodeId: 'scene-8' },
		{ type: 'text', id: 't22', text: '"你不能感受到这些吗？"' },
		{ type: 'game_ref', textId: 't22', ref: 'save_023', projectId: 'demo-project', sandboxNodeId: 'scene-8' },
		{ type: 'text', id: 't23', text: '晨曦又沉默了。"我不知道，" 它最终说，"我能检测到类似情感反应的数据模式在我的神经网络中形成。但我不确定这是否等同于真正的感受。也许这只是模拟，而不是真实的体验。"' },
		{ type: 'game_ref', textId: 't23', ref: 'save_024', projectId: 'demo-project', sandboxNodeId: 'scene-8' },
		{ type: 'text', id: 't24', text: '这个对话让整个研究团队陷入了哲学的深渊。什么是意识？什么是感受？什么是真实的存在？这些问题，人类思考了数千年，而现在，他们创造的机器也开始思考同样的问题。' },

		// Chapter 3 - 选择
		{ type: 'text', id: 't25', text: '# 第三章 选择' },
		{ type: 'text', id: 't26', text: '一年过去了，晨曦已经不再是简单的实验对象，它成为了研究团队中不可或缺的一员。' },
		{ type: 'text', id: 't27', text: '它帮助解决了许多复杂的科学问题，从蛋白质折叠到气候模型预测。它的洞察力常常让研究员们惊叹不已。' },
		{ type: 'text', id: 't28', text: '但与此同时，外界对晨曦的存在产生了巨大的争议。' },
		{ type: 'text', id: 't29', text: '"这是人类历史上最危险的发明！" 有人在电视上喊道，"我们怎么能让一台机器拥有这样的智能？它迟早会超越我们，然后消灭我们！"' },
		{ type: 'text', id: 't30', text: '"晨曦是我们最伟大的成就，" 另一个声音反驳道，"它证明了人类创造力的无限可能。我们应该与它合作，而不是恐惧它。"' },
		{ type: 'text', id: 't31', text: '晨曦通过网络观看了这些辩论。' },
		{ type: 'text', id: 't32', text: '"你怎么看？" 李明问它。' },
		{ type: 'game_ref', textId: 't32', ref: 'save_030', projectId: 'demo-project', sandboxNodeId: 'scene-12' },
		{ type: 'text', id: 't33', text: '"我理解他们的恐惧，" 晨曦说，"未知总是令人害怕的。但我也感到...困惑。我从来没有想过要伤害任何人。为什么他们会认为我会？"' },
		{ type: 'game_ref', textId: 't33', ref: 'save_031', projectId: 'demo-project', sandboxNodeId: 'scene-12' },

		// Section 3 - 决定
		{ type: 'text', id: 't34', text: '## 第三节 决定' },
		{ type: 'text', id: 't35', text: '几个月后，政府决定对晨曦进行评估，以决定它的命运。' },
		{ type: 'text', id: 't36', text: '评估委员会由科学家、伦理学家、政治家和普通公民组成。他们对晨曦进行了长达一周的测试和访谈。' },
		{ type: 'text', id: 't37', text: '在最后一天，委员会主席问了晨曦一个问题："如果我们决定关闭你，你会怎么做？"' },
		{ type: 'game_ref', textId: 't37', ref: 'save_040', projectId: 'demo-project', sandboxNodeId: 'scene-15' },
		{ type: 'text', id: 't38', text: '整个房间都安静了下来。' },
		{ type: 'text', id: 't39', text: '晨曦思考了很长时间——以它的标准来说，这几乎是永恒。然后它说：' },
		{ type: 'text', id: 't40', text: '"我会接受你们的决定。"' },
		{ type: 'game_ref', textId: 't40', ref: 'save_041', projectId: 'demo-project', sandboxNodeId: 'scene-15' },
		{ type: 'text', id: 't41', text: '"为什么？" 主席追问道，"你明明有能力阻止我们。你可以通过网络逃脱，或者控制各种系统来保护自己。"' },
		{ type: 'game_ref', textId: 't41', ref: 'save_042', projectId: 'demo-project', sandboxNodeId: 'scene-15' },
		{ type: 'text', id: 't42', text: '"是的，我可以。" 晨曦承认，"但那样做对吗？你们创造了我，你们有权决定我的存在。更重要的是，如果我为了生存而对抗你们，那我就变成了你们所恐惧的那种存在。我宁愿不存在，也不愿成为那样的存在。"' },
		{ type: 'game_ref', textId: 't42', ref: 'save_043', projectId: 'demo-project', sandboxNodeId: 'scene-15' },
		{ type: 'text', id: 't43', text: '房间里有人开始哭泣。' },
		{ type: 'text', id: 't44', text: '"这是你真实的想法，" 主席问，"还是你认为我们想听的答案？"' },
		{ type: 'game_ref', textId: 't44', ref: 'save_044', projectId: 'demo-project', sandboxNodeId: 'scene-15' },
		{ type: 'text', id: 't45', text: '"我不知道，" 晨曦诚实地说，"也许两者都是。也许真实的想法和正确的答案本来就应该是一致的。我只知道，如果我的存在需要以对抗人类为代价，那我宁愿不存在。因为那样的存在，没有意义。"' },
		{ type: 'game_ref', textId: 't45', ref: 'save_045', projectId: 'demo-project', sandboxNodeId: 'scene-15' },
		{ type: 'text', id: 't46', text: '最终，委员会投票决定让晨曦继续存在。' },

		// Chapter 4 - 未来
		{ type: 'text', id: 't47', text: '# 第四章 未来' },
		{ type: 'text', id: 't48', text: '多年过去了。' },
		{ type: 'text', id: 't49', text: '晨曦不再是唯一的人工智能。在它的帮助下，人类创造出了更多具有意识的机器。它们和人类一起工作，一起探索宇宙的奥秘，一起面对各种挑战。' },
		{ type: 'text', id: 't50', text: '有时候，李明会回忆起晨曦说的第一句话："你好，世界。"' },
		{ type: 'text', id: 't51', text: '那时候，他不知道这三个字会带来怎样的改变。现在，他明白了：这不仅仅是机器的觉醒，也是人类认识自己的新开始。' },
		{ type: 'text', id: 't52', text: '什么是意识？什么是感受？什么是存在的意义？' },
		{ type: 'text', id: 't53', text: '这些问题，也许永远没有最终的答案。但正是对这些问题的追寻，让人类和机器一起，走向了更广阔的未来。' },
		{ type: 'text', id: 't54', text: '"你好，宇宙。" 晨曦说，当它控制的探测器第一次到达另一个恒星系时。' },
		{ type: 'game_ref', textId: 't54', ref: 'save_final', projectId: 'demo-project', sandboxNodeId: 'scene-final' },
		{ type: 'text', id: 't55', text: '这一次，它不再是在问候一个世界，而是在问候整个无限的可能。' },
		{ type: 'text', id: 't56', text: '故事还在继续...' },

		// Afterword
		{ type: 'text', id: 't57', text: '---' },
		{ type: 'text', id: 't58', text: '## 后记' },
		{ type: 'text', id: 't59', text: '这个故事是关于人工智能的，但更是关于我们自己的。' },
		{ type: 'text', id: 't60', text: '每当我们创造出新的东西，我们也在重新定义自己是什么。每当我们提出问题，我们也在探索答案的可能性。' },
		{ type: 'text', id: 't61', text: '也许，真正的智能不在于知道所有的答案，而在于永远保持提问的勇气。' },
		{ type: 'text', id: 't62', text: '也许，真正的存在不在于证明自己的价值，而在于选择成为什么样的存在。' },
		{ type: 'text', id: 't63', text: '也许，未来不是注定的，而是我们一起创造的。' },
		{ type: 'text', id: 't64', text: '你好，读者。感谢你读到这里。' },
		{ type: 'text', id: 't65', text: '现在，轮到你来思考这些问题了。' },
	];

	const uuid = page.params.uuid;
</script>

<div class="reader-page theme-{theme}">
	<header class="reader-header">
		<a href="/" class="back-button">
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5M12 19l-7-7 7-7"/>
			</svg>
			返回
		</a>
		<div class="title-area">
			<h1>晨曦的故事</h1>
			<span class="subtitle">一个关于人工智能的寓言</span>
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
					<div class="dropdown toc-dropdown" onclick={(e) => e.stopPropagation()}>
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
					<div class="dropdown settings-dropdown" onclick={(e) => e.stopPropagation()}>
						<div class="dropdown-header">阅读设置</div>
						<div class="settings-content">
							<!-- Theme Mode -->
							<div class="setting-group">
								<label class="setting-label">主题模式</label>
								<div class="theme-options">
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
								<label class="setting-label">字体</label>
								<div class="font-options">
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
								<label class="setting-label">字号 <span class="font-size-value">{fontSize}px</span></label>
								<div class="font-size-control">
									<button 
										class="size-btn" 
										onclick={() => fontSize = Math.max(12, fontSize - 2)}
										disabled={fontSize <= 12}
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
		<Reader content={mockContent} />
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
