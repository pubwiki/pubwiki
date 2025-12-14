<!--
  Mock Demo: Pre-defined chat data demonstration
  
  This page shows the ChatMessages component with mock data,
  no API key required.
-->
<script lang="ts">
  import { browser } from '$app/environment'
  import { ChatMessages, type DisplayMessage } from '@pubwiki/svelte-chat'

  // Theme state
  let isDark = $state(false)
  
  // Initialize from localStorage or system preference
  $effect(() => {
    if (browser) {
      const stored = localStorage.getItem('theme')
      if (stored) {
        isDark = stored === 'dark'
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      }
      updateTheme()
    }
  })
  
  function toggleTheme() {
    isDark = !isDark
    if (browser) {
      localStorage.setItem('theme', isDark ? 'dark' : 'light')
      updateTheme()
    }
  }
  
  function updateTheme() {
    if (browser) {
      document.documentElement.classList.toggle('dark', isDark)
    }
  }

  // Mock messages with various block types
  const mockMessages: DisplayMessage[] = [
    {
      id: 'msg-1',
      parentId: null,
      role: 'user',
      blocks: [
        { id: 'block-1-1', type: 'markdown', content: '你好！请帮我写一个简单的 TypeScript 函数来计算斐波那契数列。' }
      ],
      timestamp: Date.now() - 300000
    },
    {
      id: 'msg-2',
      parentId: 'msg-1',
      role: 'assistant',
      blocks: [
        { 
          id: 'block-2-1', 
          type: 'markdown', 
          content: '好的！这是一个计算斐波那契数列的 TypeScript 函数：' 
        },
        { 
          id: 'block-2-2', 
          type: 'code', 
          content: JSON.stringify({
            language: 'typescript',
            code: `function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// 使用示例
console.log(fibonacci(10)); // 输出: 55

// 更高效的迭代版本
function fibonacciIterative(n: number): number {
  if (n <= 1) return n;
  
  let prev = 0, curr = 1;
  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  return curr;
}`
          })
        },
        {
          id: 'block-2-3',
          type: 'markdown',
          content: '我提供了两个版本：\n\n1. **递归版本** - 简洁但效率较低，时间复杂度 O(2^n)\n2. **迭代版本** - 更高效，时间复杂度 O(n)\n\n对于大数值，建议使用迭代版本。'
        }
      ],
      timestamp: Date.now() - 290000,
      model: 'gpt-4o'
    },
    {
      id: 'msg-3',
      parentId: 'msg-2',
      role: 'user',
      blocks: [
        { id: 'block-3-1', type: 'markdown', content: '能给我展示一个带有工具调用的例子吗？比如搜索文件。' }
      ],
      timestamp: Date.now() - 200000
    },
    {
      id: 'msg-4',
      parentId: 'msg-3',
      role: 'assistant',
      blocks: [
        {
          id: 'block-4-1',
          type: 'markdown',
          content: '当然！让我搜索一下项目中的 TypeScript 文件：'
        },
        {
          id: 'block-4-2',
          type: 'tool_call',
          content: '',
          toolCallId: 'call-123',
          toolName: 'search_files',
          toolArgs: JSON.stringify({ pattern: '*.ts', directory: 'src' }, null, 2),
          toolStatus: 'completed'
        },
        {
          id: 'block-4-3',
          type: 'tool_result',
          content: JSON.stringify({
            files: [
              'src/index.ts',
              'src/utils/helpers.ts',
              'src/components/Button.ts',
              'src/types/index.ts'
            ],
            total: 4
          }, null, 2),
          toolCallId: 'call-123'
        },
        {
          id: 'block-4-4',
          type: 'markdown',
          content: '找到了 4 个 TypeScript 文件！你想查看其中哪个文件的内容？'
        }
      ],
      timestamp: Date.now() - 190000,
      model: 'gpt-4o'
    },
    {
      id: 'msg-5',
      parentId: 'msg-4',
      role: 'user',
      blocks: [
        { id: 'block-5-1', type: 'markdown', content: '展示一下表格数据的渲染效果' }
      ],
      timestamp: Date.now() - 100000
    },
    {
      id: 'msg-6',
      parentId: 'msg-5',
      role: 'assistant',
      blocks: [
        {
          id: 'block-6-1',
          type: 'markdown',
          content: '这是一个 Markdown 表格示例：\n\n| 功能 | 状态 | 优先级 |\n|------|------|--------|\n| 用户认证 | ✅ 完成 | 高 |\n| 数据导出 | 🔄 进行中 | 中 |\n| 暗色主题 | 📋 计划中 | 低 |\n| API 文档 | ✅ 完成 | 高 |'
        },
        {
          id: 'block-6-2',
          type: 'markdown',
          content: '\n\n以及一个代码对比：'
        },
        {
          id: 'block-6-3',
          type: 'code',
          content: JSON.stringify({
            language: 'typescript',
            code: `// Before
const data = items.filter(x => x.active).map(x => x.name);

// After  
const data = items
  .filter(item => item.active)
  .map(item => item.name);`
          })
        }
      ],
      timestamp: Date.now() - 90000,
      model: 'gpt-4o'
    },
    {
      id: 'msg-7',
      parentId: 'msg-6',
      role: 'user',
      blocks: [
        { id: 'block-7-1', type: 'markdown', content: '最后展示一下长文本和推理过程' }
      ],
      timestamp: Date.now() - 50000
    },
    {
      id: 'msg-8',
      parentId: 'msg-7',
      role: 'assistant',
      blocks: [
        {
          id: 'block-8-1',
          type: 'reasoning',
          content: '用户想看长文本和推理过程的展示效果。我应该：\n1. 展示一段较长的 markdown 内容\n2. 包含多种格式元素\n3. 这个推理块本身就是展示推理过程的例子'
        },
        {
          id: 'block-8-2',
          type: 'markdown',
          content: `## 关于 @pubwiki/svelte-chat 组件库

这是一个基于 **Svelte 5** 构建的现代化聊天 UI 组件库，具有以下特点：

### 核心功能

1. **消息渲染** - 支持多种消息类型
   - Markdown 文本
   - 代码块（带语法高亮）
   - 工具调用和结果
   - 图片展示
   - 推理过程展示

2. **实时流式输出** - 支持流式 API 响应
   - Token-by-token 渲染
   - 打字机效果
   - 中断功能

3. **状态管理** - 使用 Svelte 5 Runes
   - \`$state\` 响应式状态
   - \`$derived\` 派生状态
   - \`$effect\` 副作用处理

### 技术栈

- **前端框架**: Svelte 5
- **样式方案**: Tailwind CSS 4
- **类型系统**: TypeScript
- **构建工具**: Vite + SvelteKit

> 💡 **提示**: 这个组件库设计为与 \`@pubwiki/chat\` 核心库配合使用，但也可以独立使用进行 UI 展示。

---

感谢你的体验！如有问题请随时提问。 🎉`
        }
      ],
      timestamp: Date.now() - 40000,
      model: 'gpt-4o',
      metadata: {
        reasoning: '用户想看长文本和推理过程的展示效果。我应该：\n1. 展示一段较长的 markdown 内容\n2. 包含多种格式元素\n3. 这个推理块本身就是展示推理过程的例子'
      }
    }
  ]

  // Event handlers
  function handleCopy(content: string) {
    navigator.clipboard.writeText(content)
    console.log('Copied to clipboard')
  }

  function handleEdit(id: string) {
    console.log('Edit message:', id)
    alert('编辑功能演示 - Message ID: ' + id)
  }

  function handleRegenerate(id: string) {
    console.log('Regenerate message:', id)
    alert('重新生成功能演示 - Message ID: ' + id)
  }
</script>

<svelte:head>
  <title>Mock Demo - @pubwiki/svelte-chat</title>
</svelte:head>

<div class="flex h-screen flex-col bg-white dark:bg-zinc-900">
  <!-- Header -->
  <header class="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-zinc-700 dark:bg-zinc-800">
    <div>
      <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">Mock Data Demo</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400">预定义聊天数据展示，无需 API Key</p>
    </div>
    <div class="flex items-center gap-3">
      <!-- Theme Toggle -->
      <button
        type="button"
        onclick={toggleTheme}
        class="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 dark:border-zinc-600 dark:bg-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-600"
        title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
      >
        {#if isDark}
          <!-- Sun icon -->
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        {:else}
          <!-- Moon icon -->
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        {/if}
      </button>
      <a 
        href="/stream"
        class="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-600"
      >
        流式演示
      </a>
      <a 
        href="/"
        class="rounded-md bg-blue-500 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600"
      >
        返回实时聊天
      </a>
    </div>
  </header>
  
  <!-- Chat Area -->
  <div class="min-h-0 flex-1">
    <ChatMessages 
      messages={mockMessages}
      showAvatars={true}
      showActions={true}
      onCopy={handleCopy}
      onEdit={handleEdit}
      onRegenerate={handleRegenerate}
      class="h-full"
    />
  </div>
</div>
