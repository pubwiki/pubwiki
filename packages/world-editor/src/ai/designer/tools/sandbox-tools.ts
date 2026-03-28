/**
 * Sandbox Interaction Tools for the Designer Agent
 *
 * Provides tools to view console logs and verify frontend changes.
 * Enables the designer to iterate on code with build-error feedback
 * and expected-log verification.
 */

import { z } from 'zod'
import { defineTool, type ChatMessage, type AfterExecutionHook } from '@pubwiki/chat'

// ============================================================================
// Types
// ============================================================================

/**
 * Async getter for sandbox connection.
 * When the preview is not yet open, the implementation should auto-open it
 * and wait for the connection to be established.
 * Returns null only when the sandbox truly cannot be opened (e.g. missing VFS/config).
 */
export type SandboxConnectionGetter = () => Promise<SandboxConnectionLike | null>

/** Log entry from the sandbox console */
export interface SandboxLogEntry {
  level: string
  timestamp: number
  message: string
  stack?: string
}

/** Minimal interface matching SandboxConnection's public API used by tools */
export interface SandboxConnectionLike {
  getLogs(): SandboxLogEntry[]
  clearLogs(): void
  reload(): void
  /** Subscribe to live log events. Returns unsubscribe function. */
  onLog(callback: (entry: SandboxLogEntry) => void): () => void
  /** Subscribe to build error events. Returns unsubscribe function. */
  onBuildError(callback: (errors: string[]) => void): () => void
  /** Capture a screenshot of the sandbox user iframe */
  takeScreenshot(): Promise<string>
}

// ============================================================================
// Tool Factories
// ============================================================================

/**
 * get_console_logs — View console output from the sandbox preview.
 */
export function createGetConsoleLogsTool(getConnection: SandboxConnectionGetter) {
  return defineTool({
    name: 'get_console_logs',
    description:
      '获取 sandbox 预览的控制台日志（console.log / warn / error 等）。' +
      '用于检查运行时错误和调试输出。可选 level 过滤日志级别，tail 限制返回条数。',
    schema: z.object({
      level: z.enum(['log', 'info', 'warn', 'error', 'debug']).optional()
        .describe('过滤日志级别。省略则返回所有级别。'),
      tail: z.number().optional()
        .describe('只返回最新的 N 条日志。省略则返回全部（最多500条）。'),
      clear: z.boolean().optional()
        .describe('读取后是否清空日志。默认 false。'),
    }),
    handler: async ({ level, tail, clear }) => {
      const conn = await getConnection()
      if (!conn) {
        return '⚠️ Failed to open sandbox preview. Make sure the frontend VFS node is properly configured.'
      }

      let logs = conn.getLogs()

      // Filter by level
      if (level) {
        logs = logs.filter(l => l.level === level)
      }

      // Tail
      if (tail && tail > 0 && logs.length > tail) {
        logs = logs.slice(-tail)
      }

      // Clear after reading if requested
      if (clear) {
        conn.clearLogs()
      }

      if (logs.length === 0) {
        return level
          ? `📋 No ${level} logs in console.`
          : '📋 Console is empty — no logs yet.'
      }

      return formatLogs(logs, level)
    },
  })
}

/**
 * verify_frontend — Reload sandbox and verify expected console log appears.
 *
 * Workflow: clear logs → reload → wait for build → if build error, return immediately →
 * otherwise wait for expected log within timeout → return result.
 */
export function createVerifyFrontendTool(getConnection: SandboxConnectionGetter) {
  return defineTool({
    name: 'verify_frontend',
    description:
      '重新构建并加载前端应用，验证是否成功启动。' +
      '会清空旧日志并 reload sandbox，如果构建失败则立刻返回错误信息。' +
      '构建成功后等待期望的 console.log 出现，超时则返回收集到的所有日志。' +
      '⚠️ 每次修改代码后必须调用此工具验证。',
    schema: z.object({
      expect: z.string()
        .describe('期望在 console.log 中看到的字符串（子串匹配）。确保你的代码在加载成功后用 console.log 输出了这个字符串。'),
      timeout: z.number().optional().default(5)
        .describe('等待期望 log 的超时时间（秒）。从构建完成、app 开始加载算起。默认 5s。'),
    }),
    handler: async ({ expect, timeout }) => {
      const conn = await getConnection()
      if (!conn) {
        return '⚠️ Failed to open sandbox preview. Make sure the frontend VFS node is properly configured.'
      }

      const timeoutMs = (timeout ?? 5) * 1000

      // Clear old logs
      conn.clearLogs()

      // Set up listeners BEFORE reload
      const collectedLogs: SandboxLogEntry[] = []
      let buildErrorMessages: string[] | null = null
      let foundExpected = false

      const t0 = Date.now()
      console.log(`[verify_frontend] Starting. expect="${expect}", timeout=${timeoutMs}ms`)

      // Promise that resolves when expected log is found, build error occurs, or timeout
      const result = await new Promise<{ type: 'found' | 'build_error' | 'timeout'; buildErrors?: string[] }>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null
        let unsubLog: (() => void) | null = null
        let unsubBuild: (() => void) | null = null

        const cleanup = () => {
          if (timer) clearTimeout(timer)
          unsubLog?.()
          unsubBuild?.()
        }

        // Listen for build errors
        unsubBuild = conn.onBuildError((errors) => {
          console.log(`[verify_frontend] onBuildError fired at +${Date.now() - t0}ms, errors:`, errors)
          buildErrorMessages = errors
          cleanup()
          resolve({ type: 'build_error', buildErrors: errors })
        })

        // Listen for logs
        unsubLog = conn.onLog((entry) => {
          console.log(`[verify_frontend] onLog at +${Date.now() - t0}ms: [${entry.level}] ${entry.message.slice(0, 120)}`)
          collectedLogs.push(entry)
          if (!foundExpected && entry.message.includes(expect)) {
            foundExpected = true
            // Keep collecting logs for 1s more to catch late errors
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              cleanup()
              resolve({ type: 'found' })
            }, 1000)
          }
        })

        // Start timeout timer
        timer = setTimeout(() => {
          console.log(`[verify_frontend] Timeout fired at +${Date.now() - t0}ms. collectedLogs=${collectedLogs.length}, buildError=${!!buildErrorMessages}`)
          cleanup()
          resolve({ type: 'timeout' })
        }, timeoutMs)

        // Trigger reload AFTER listeners are set up
        console.log(`[verify_frontend] Calling conn.reload() at +${Date.now() - t0}ms`)
        conn.reload()
        console.log(`[verify_frontend] conn.reload() returned at +${Date.now() - t0}ms`)
      })

      console.log(`[verify_frontend] Resolved with type="${result.type}" at +${Date.now() - t0}ms`)

      switch (result.type) {
        case 'build_error': {
          const errorText = result.buildErrors?.join('\n') ?? 'Unknown build error'
          return `❌ Build failed:\n\`\`\`\n${errorText}\n\`\`\`\nFix the build errors and try again.`
        }
        case 'found': {
          // Check if there are errors alongside the expected log
          const errors = collectedLogs.filter(l => l.level === 'error')
          if (errors.length > 0) {
            return `⚠️ Expected log found, but there are ${errors.length} error(s):\n${formatLogs(errors)}\n\nFix the errors before proceeding.`
          }
          return `✅ Frontend loaded successfully. Found expected log: "${expect}"`
        }
        case 'timeout': {
          if (collectedLogs.length === 0) {
            return `❌ Timeout (${timeout}s): No console output at all. The app may not be loading. Check your entry point and imports.`
          }
          return `❌ Timeout (${timeout}s): Expected log "${expect}" not found.\nCollected logs:\n${formatLogs(collectedLogs)}`
        }
      }
    },
  })
}

/**
 * screenshot_app — Capture a screenshot of the running app.
 *
 * The screenshot is injected as a user image message via afterExecution hook,
 * so the LLM can "see" the app on the next turn.
 */
export function createScreenshotTool(getConnection: SandboxConnectionGetter) {
  // Shared state: the latest screenshot data URL captured by the handler.
  // The afterExecution hook reads and clears it.
  let pendingScreenshot: string | null = null

  const afterExecution: AfterExecutionHook = (messages: ChatMessage[]) => {
    if (!pendingScreenshot) return
    const dataUrl = pendingScreenshot
    pendingScreenshot = null

    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Here is the screenshot of the current app:' },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ],
    })
  }

  return defineTool({
    name: 'screenshot_app',
    description:
      '对当前运行的前端应用截图。截图会在下一轮对话中以图片形式展示给你，' +
      '让你能"看到"应用的实际渲染效果。用于检查布局、样式和视觉问题。',
    schema: z.object({}),
    handler: async () => {
      const conn = await getConnection()
      if (!conn) {
        return '⚠️ Failed to open sandbox preview.'
      }

      try {
        const dataUrl = await conn.takeScreenshot()
        if (!dataUrl) {
          return '⚠️ Screenshot capture returned empty result. The app may not be rendered yet.'
        }
        pendingScreenshot = dataUrl
        return '✅ Screenshot captured. You will see the image in the next message.'
      } catch (error) {
        return `⚠️ Screenshot failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
    afterExecution,
  })
}

// ============================================================================
// Helpers
// ============================================================================

function formatLogs(logs: SandboxLogEntry[], levelFilter?: string): string {
  const lines = logs.map(entry => {
    const time = new Date(entry.timestamp).toISOString().slice(11, 23)
    const prefix = `[${time}] [${entry.level.toUpperCase()}]`
    const msg = entry.message.length > 2000
      ? entry.message.slice(0, 2000) + '... (truncated)'
      : entry.message
    if (entry.stack) {
      return `${prefix} ${msg}\n${entry.stack}`
    }
    return `${prefix} ${msg}`
  })

  const header = levelFilter
    ? `Console logs (${levelFilter}, ${logs.length} entries):`
    : `Console logs (${logs.length} entries):`

  return `${header}\n\`\`\`\n${lines.join('\n')}\n\`\`\``
}
