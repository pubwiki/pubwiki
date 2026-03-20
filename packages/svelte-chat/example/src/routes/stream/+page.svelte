<!--
  Stream Demo: Simulated streaming output demonstration
  
  This page simulates streaming AI responses with:
  - Token-by-token text output
  - Tool calls with loading states
  - Code blocks
  - Reasoning blocks
-->
<script lang="ts">
  import { browser } from '$app/environment'
  import { resolve } from '$app/paths'
  import { ChatMessages, type DisplayMessage, type UIMessageBlock } from '@pubwiki/svelte-chat'

  // Theme state
  let isDark = $state(false)
  
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

  // Chat state
  let messages = $state<DisplayMessage[]>([])
  let streamingMessage = $state<{
    id: string
    role: 'assistant'
    blocks: UIMessageBlock[]
    model?: string
    reasoning?: string
  } | null>(null)
  let isStreaming = $state(false)
  let streamSpeed = $state(30) // ms per token

  // Response types for scenarios
  type SimpleResponse = { type: 'simple'; content: string }
  type WithReasoningResponse = { type: 'with_reasoning'; reasoning: string; content: string }
  type WithToolCallResponse = { 
    type: 'with_tool_call'
    preText: string
    toolCall: { id: string; name: string; args: Record<string, unknown> }
    toolResult: unknown
    postText: string
  }
  type WithCodeResponse = {
    type: 'with_code'
    preText: string
    code: { language: string; content: string }
    postText: string
  }
  type MultiToolCallResponse = {
    type: 'multi_tool_call'
    steps: Array<{
      text: string
      toolCall: { id: string; name: string; args: Record<string, unknown> }
      toolResult: string
    }>
    finalText: string
  }
  type ScenarioResponse = SimpleResponse | WithReasoningResponse | WithToolCallResponse | WithCodeResponse | MultiToolCallResponse

  interface Scenario {
    name: string
    userMessage: string
    response: ScenarioResponse
  }

  // Predefined streaming scenarios
  const scenarios: Scenario[] = [
    {
      name: '简单文本回复',
      userMessage: '你好，介绍一下你自己',
      response: {
        type: 'simple',
        content: `你好！我是一个 AI 助手，很高兴认识你！

我可以帮助你：
- **编写代码** - 支持多种编程语言
- **回答问题** - 提供详细的解释
- **分析问题** - 帮助你思考和解决问题
- **创意写作** - 生成各种文本内容

有什么我可以帮助你的吗？ 😊`
      }
    },
    {
      name: '带推理的回复',
      userMessage: '帮我分析一下快速排序的时间复杂度',
      response: {
        type: 'with_reasoning',
        reasoning: `用户问的是快速排序的时间复杂度分析。我需要：
1. 解释快速排序的基本原理
2. 分析最好、最坏和平均情况
3. 给出具体的复杂度公式
4. 可能需要提供代码示例来说明`,
        content: `## 快速排序时间复杂度分析

快速排序是一种高效的分治排序算法，其时间复杂度取决于 **pivot（基准元素）** 的选择。

### 三种情况

| 情况 | 时间复杂度 | 说明 |
|------|-----------|------|
| 最好 | O(n log n) | 每次都能均匀分割 |
| 平均 | O(n log n) | 随机数据 |
| 最坏 | O(n²) | 已排序数据 |

### 空间复杂度
- **平均**: O(log n) - 递归栈深度
- **最坏**: O(n) - 完全不平衡的递归

> 💡 **优化建议**: 使用三数取中法选择 pivot 可以避免最坏情况`
      }
    },
    {
      name: '带工具调用的回复',
      userMessage: '帮我查找项目中的配置文件',
      response: {
        type: 'with_tool_call',
        preText: '好的，让我帮你搜索项目中的配置文件：',
        toolCall: {
          id: 'call-' + Date.now(),
          name: 'search_files',
          args: { pattern: '*.config.*', directory: './' }
        },
        toolResult: {
          files: [
            'vite.config.ts',
            'tailwind.config.js',
            'tsconfig.json',
            'eslint.config.js',
            'postcss.config.cjs'
          ],
          total: 5
        },
        postText: `找到了 **5 个配置文件**！

主要配置文件说明：
1. \`vite.config.ts\` - Vite 构建工具配置
2. \`tailwind.config.js\` - Tailwind CSS 样式配置
3. \`tsconfig.json\` - TypeScript 编译配置
4. \`eslint.config.js\` - ESLint 代码检查配置
5. \`postcss.config.cjs\` - PostCSS 处理配置

需要我帮你查看某个配置文件的内容吗？`
      }
    },
    {
      name: '带代码的回复',
      userMessage: '写一个 React Hook 来管理本地存储',
      response: {
        type: 'with_code',
        preText: '这是一个管理本地存储的自定义 React Hook：',
        code: {
          language: 'typescript',
          content: `import { useState, useEffect } from 'react';

function useLocalStorage<T>(key: string, initialValue: T) {
  // 获取初始值
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  // 更新本地存储
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function 
        ? value(storedValue) 
        : value;
      setStoredValue(valueToStore);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue] as const;
}

export default useLocalStorage;`
        },
        postText: `### 使用示例

\`\`\`tsx
const [theme, setTheme] = useLocalStorage('theme', 'light');
const [user, setUser] = useLocalStorage('user', null);
\`\`\`

这个 Hook 提供了：
- ✅ 类型安全的泛型支持
- ✅ SSR 兼容（检查 window）
- ✅ 自动 JSON 序列化/反序列化
- ✅ 错误处理`
      }
    },
    {
      name: '多工具调用',
      userMessage: '帮我读取 package.json 并分析依赖',
      response: {
        type: 'multi_tool_call',
        steps: [
          {
            text: '让我先读取 package.json 文件：',
            toolCall: {
              id: 'call-read-' + Date.now(),
              name: 'read_file',
              args: { path: 'package.json' }
            },
            toolResult: JSON.stringify({
              name: '@pubwiki/svelte-chat-example',
              version: '0.1.0',
              dependencies: {
                '@pubwiki/chat': 'workspace:*',
                '@pubwiki/svelte-chat': 'workspace:*',
                'svelte': '^5.0.0'
              },
              devDependencies: {
                '@sveltejs/kit': '^2.0.0',
                'typescript': '^5.0.0',
                'vite': '^6.0.0'
              }
            }, null, 2)
          },
          {
            text: '现在让我检查一下是否有安全漏洞：',
            toolCall: {
              id: 'call-audit-' + Date.now(),
              name: 'run_command',
              args: { command: 'pnpm audit' }
            },
            toolResult: 'No known vulnerabilities found\n\nScanned 156 packages in 1.2s'
          }
        ],
        finalText: `## 依赖分析报告

### 📦 项目依赖

**运行时依赖 (3 个)**
| 包名 | 版本 |
|------|------|
| @pubwiki/chat | workspace:* |
| @pubwiki/svelte-chat | workspace:* |
| svelte | ^5.0.0 |

**开发依赖 (3 个)**
| 包名 | 版本 |
|------|------|
| @sveltejs/kit | ^2.0.0 |
| typescript | ^5.0.0 |
| vite | ^6.0.0 |

### ✅ 安全检查
没有发现已知漏洞，共扫描 156 个包。

> 建议定期运行 \`pnpm audit\` 检查安全更新。`
      }
    }
  ]

  // Simulate streaming text
  async function streamText(text: string, updateFn: (partial: string) => void) {
    let partial = ''
    for (const char of text) {
      partial += char
      updateFn(partial)
      await sleep(streamSpeed)
    }
  }

  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Run a scenario
  async function runScenario(scenarioIndex: number) {
    if (isStreaming) return
    
    const scenario = scenarios[scenarioIndex]
    isStreaming = true

    // Add user message
    const userMsg: DisplayMessage = {
      id: `msg-user-${Date.now()}`,
      parentId: null,
      role: 'user',
      blocks: [{ id: `block-${Date.now()}`, type: 'markdown', content: scenario.userMessage }],
      timestamp: Date.now()
    }
    messages = [...messages, userMsg]

    await sleep(500)

    // Start streaming response
    const assistantId = `msg-assistant-${Date.now()}`
    streamingMessage = {
      id: assistantId,
      role: 'assistant',
      blocks: [],
      model: 'gpt-4o'
    }

    const response = scenario.response

    if (response.type === 'simple') {
      // Simple text streaming
      await streamText(response.content, (partial) => {
        streamingMessage = {
          ...streamingMessage!,
          blocks: [{ id: 'block-text', type: 'markdown', content: partial }]
        }
      })
    } 
    else if (response.type === 'with_reasoning') {
      // Stream reasoning first
      streamingMessage = {
        ...streamingMessage!,
        reasoning: ''
      }
      await streamText(response.reasoning, (partial) => {
        streamingMessage = {
          ...streamingMessage!,
          reasoning: partial
        }
      })
      await sleep(300)
      
      // Then stream content
      await streamText(response.content, (partial) => {
        streamingMessage = {
          ...streamingMessage!,
          blocks: [{ id: 'block-text', type: 'markdown', content: partial }]
        }
      })
    }
    else if (response.type === 'with_tool_call') {
      // Stream pre-text
      await streamText(response.preText, (partial) => {
        streamingMessage = {
          ...streamingMessage!,
          blocks: [{ id: 'block-pre', type: 'markdown', content: partial }]
        }
      })
      await sleep(200)

      // Add tool call (running state)
      const toolCallBlock: UIMessageBlock = {
        id: 'block-tool',
        type: 'tool_call',
        content: '',
        toolCallId: response.toolCall.id,
        toolName: response.toolCall.name,
        toolArgs: JSON.stringify(response.toolCall.args, null, 2),
        toolStatus: 'running'
      }
      streamingMessage = {
        ...streamingMessage!,
        blocks: [
          { id: 'block-pre', type: 'markdown', content: response.preText },
          toolCallBlock
        ]
      }
      await sleep(1500) // Simulate tool execution

      // Tool completed with result
      const toolResultBlock: UIMessageBlock = {
        id: 'block-result',
        type: 'tool_result',
        content: JSON.stringify(response.toolResult, null, 2),
        toolCallId: response.toolCall.id
      }
      streamingMessage = {
        ...streamingMessage!,
        blocks: [
          { id: 'block-pre', type: 'markdown', content: response.preText },
          { ...toolCallBlock, toolStatus: 'completed' },
          toolResultBlock
        ]
      }
      await sleep(300)

      // Stream post-text
      let postText = ''
      await streamText(response.postText, (partial) => {
        postText = partial
        streamingMessage = {
          ...streamingMessage!,
          blocks: [
            { id: 'block-pre', type: 'markdown', content: response.preText },
            { ...toolCallBlock, toolStatus: 'completed' },
            toolResultBlock,
            { id: 'block-post', type: 'markdown', content: postText }
          ]
        }
      })
    }
    else if (response.type === 'with_code') {
      // Stream pre-text
      await streamText(response.preText, (partial) => {
        streamingMessage = {
          ...streamingMessage!,
          blocks: [{ id: 'block-pre', type: 'markdown', content: partial }]
        }
      })
      await sleep(200)

      // Add code block (stream it too)
      let codeContent = ''
      await streamText(response.code.content, (partial) => {
        codeContent = partial
        streamingMessage = {
          ...streamingMessage!,
          blocks: [
            { id: 'block-pre', type: 'markdown', content: response.preText },
            { 
              id: 'block-code', 
              type: 'code', 
              content: JSON.stringify({ code: codeContent, language: response.code.language })
            }
          ]
        }
      })
      await sleep(300)

      // Stream post-text
      await streamText(response.postText, (partial) => {
        streamingMessage = {
          ...streamingMessage!,
          blocks: [
            { id: 'block-pre', type: 'markdown', content: response.preText },
            { 
              id: 'block-code', 
              type: 'code', 
              content: JSON.stringify({ code: response.code.content, language: response.code.language })
            },
            { id: 'block-post', type: 'markdown', content: partial }
          ]
        }
      })
    }
    else if (response.type === 'multi_tool_call') {
      const blocks: UIMessageBlock[] = []
      
      for (let i = 0; i < response.steps.length; i++) {
        const step = response.steps[i]
        
        // Stream step text
        const textBlockId = `block-text-${i}`
        await streamText(step.text, (partial) => {
          const updatedBlocks = [...blocks, { id: textBlockId, type: 'markdown' as const, content: partial }]
          streamingMessage = { ...streamingMessage!, blocks: updatedBlocks }
        })
        blocks.push({ id: textBlockId, type: 'markdown', content: step.text })
        await sleep(200)

        // Add tool call (running)
        const toolBlock: UIMessageBlock = {
          id: `block-tool-${i}`,
          type: 'tool_call',
          content: '',
          toolCallId: step.toolCall.id,
          toolName: step.toolCall.name,
          toolArgs: JSON.stringify(step.toolCall.args, null, 2),
          toolStatus: 'running'
        }
        blocks.push(toolBlock)
        streamingMessage = { ...streamingMessage!, blocks: [...blocks] }
        await sleep(1200)

        // Complete tool call
        blocks[blocks.length - 1] = { ...toolBlock, toolStatus: 'completed' }
        const resultBlock: UIMessageBlock = {
          id: `block-result-${i}`,
          type: 'tool_result',
          content: step.toolResult,
          toolCallId: step.toolCall.id
        }
        blocks.push(resultBlock)
        streamingMessage = { ...streamingMessage!, blocks: [...blocks] }
        await sleep(500)
      }

      // Stream final text
      await streamText(response.finalText, (partial) => {
        streamingMessage = {
          ...streamingMessage!,
          blocks: [...blocks, { id: 'block-final', type: 'markdown', content: partial }]
        }
      })
    }

    // Finalize message
    const finalMessage: DisplayMessage = {
      id: assistantId,
      parentId: userMsg.id,
      role: 'assistant',
      blocks: streamingMessage!.blocks,
      timestamp: Date.now(),
      model: 'gpt-4o',
      metadata: streamingMessage!.reasoning ? { reasoning: streamingMessage!.reasoning } : undefined
    }
    messages = [...messages, finalMessage]
    streamingMessage = null
    isStreaming = false
  }

  function clearChat() {
    messages = []
    streamingMessage = null
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content)
  }
</script>

<svelte:head>
  <title>Stream Demo - @pubwiki/svelte-chat</title>
</svelte:head>

<div class="flex h-screen flex-col bg-white dark:bg-zinc-900">
  <!-- Header -->
  <header class="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-zinc-700 dark:bg-zinc-800">
    <div>
      <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">流式输出演示</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400">模拟 AI 流式响应，包含工具调用、代码块等</p>
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
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        {:else}
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        {/if}
      </button>
      <a 
        href={resolve('/mock')}
        class="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-600"
      >
        静态演示
      </a>
      <a 
        href={resolve('/')}
        class="rounded-md bg-blue-500 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600"
      >
        返回首页
      </a>
    </div>
  </header>

  <!-- Scenario buttons -->
  <div class="border-b border-gray-200 bg-gray-50 px-6 py-3 dark:border-zinc-700 dark:bg-zinc-800/50">
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">选择场景：</span>
      {#each scenarios as scenario, i (scenario.name)}
        <button
          type="button"
          onclick={() => runScenario(i)}
          disabled={isStreaming}
          class="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-600"
        >
          {scenario.name}
        </button>
      {/each}
      <div class="ml-auto flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          速度：
          <input 
            type="range" 
            min="10" 
            max="100" 
            bind:value={streamSpeed}
            class="w-24"
          />
          <span class="w-12">{streamSpeed}ms</span>
        </label>
        <button
          type="button"
          onclick={clearChat}
          disabled={isStreaming}
          class="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          清空对话
        </button>
      </div>
    </div>
  </div>
  
  <!-- Chat Area -->
  <div class="min-h-0 flex-1">
    <ChatMessages 
      {messages}
      {streamingMessage}
      isLoading={false}
      showAvatars={true}
      showActions={!isStreaming}
      onCopy={handleCopy}
      class="h-full"
    />
  </div>

  <!-- Status bar -->
  {#if isStreaming}
    <div class="border-t border-gray-200 bg-blue-50 px-6 py-2 dark:border-zinc-700 dark:bg-blue-900/20">
      <div class="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
        <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        正在生成响应...
      </div>
    </div>
  {/if}
</div>
