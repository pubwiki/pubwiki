/**
 * JavaScript 沙箱执行器
 * 
 * 使用 iframe + postMessage 模式实现安全的代码执行环境。
 * 沙箱内代码可以通过 tools 对象调用宿主提供的工具。
 */

import i18next from 'i18next'
import type { SaveMemoryParams } from './types'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 沙箱工具回调函数
 */
export interface SandboxToolCallbacks {
  getStateContent: (path: string) => Promise<any>
  setStateContent: (path: string, value: any) => Promise<boolean>
  getMemoryContent: (ids: string | string[]) => Promise<string>
  saveMemory: (params: SaveMemoryParams) => Promise<string>
}

/**
 * 执行选项
 */
export interface SandboxExecuteOptions {
  timeout?: number  // 默认 5000ms
  callbacks: SandboxToolCallbacks
}

/**
 * 执行结果
 */
export interface SandboxExecuteResult {
  success: boolean
  result?: any
  logs: string[]
  error?: string
}

/**
 * 来自 iframe 的消息类型
 */
interface SandboxMessage {
  type: 'tool_call' | 'execution_complete' | 'execution_error'
  callId?: string
  toolName?: string
  params?: any
  result?: any
  logs?: string[]
  error?: string
}

// ============================================================================
// 沙箱执行器
// ============================================================================

export class SandboxExecutor {
  private iframe: HTMLIFrameElement | null = null
  private messageHandler: ((event: MessageEvent) => void) | null = null

  /**
   * 执行 JavaScript 代码
   */
  async execute(code: string, options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const timeout = options.timeout || 5000
    
    return new Promise((resolve) => {
      // 创建 iframe
      this.iframe = this.createIframe()
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.cleanup()
        resolve({
          success: false,
          logs: [],
          error: i18next.t('common:executionTimeout', { timeout })
        })
      }, timeout)
      
      // 处理来自 iframe 的消息
      this.messageHandler = async (event: MessageEvent) => {
        // 安全检查：只处理来自我们 iframe 的消息
        if (event.source !== this.iframe?.contentWindow) return
        
        const message = event.data as SandboxMessage
        
        if (message.type === 'tool_call') {
          // 处理工具调用
          try {
            let result: any
            
            switch (message.toolName) {
              case 'get_state_content':
                result = await options.callbacks.getStateContent(message.params?.path)
                break
              case 'setStateContent':
                result = await options.callbacks.setStateContent(
                  message.params?.path,
                  message.params?.value
                )
                break
              case 'get_memory_content':
                result = await options.callbacks.getMemoryContent(message.params?.ids)
                break
              case 'save_memory':
                result = await options.callbacks.saveMemory(message.params)
                break
              default:
                throw new Error(i18next.t('common:unknownTool', { name: message.toolName }))
            }
            
            // 返回结果给 iframe
            this.iframe?.contentWindow?.postMessage({
              callId: message.callId,
              result
            }, '*')
          } catch (err) {
            // 返回错误给 iframe
            this.iframe?.contentWindow?.postMessage({
              callId: message.callId,
              error: (err as Error).message
            }, '*')
          }
        } else if (message.type === 'execution_complete') {
          // 执行完成
          clearTimeout(timeoutId)
          this.cleanup()
          resolve({
            success: true,
            result: message.result,
            logs: message.logs || []
          })
        } else if (message.type === 'execution_error') {
          // 执行出错
          clearTimeout(timeoutId)
          this.cleanup()
          resolve({
            success: false,
            logs: message.logs || [],
            error: message.error
          })
        }
      }
      
      window.addEventListener('message', this.messageHandler)
      
      // 注入代码到 iframe
      this.iframe.srcdoc = this.buildSrcdoc(code)
      document.body.appendChild(this.iframe)
    })
  }

  /**
   * 创建隐藏的 iframe
   */
  private createIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe')
    iframe.sandbox.add('allow-scripts')
    iframe.style.display = 'none'
    return iframe
  }

  /**
   * 构建 iframe 的 srcdoc
   */
  private buildSrcdoc(userCode: string): string {
    // 转义用户代码中的特殊字符
    const escapedCode = userCode
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
<script>
(async function() {
  // 存储待处理的工具调用
  const pendingCalls = new Map();
  
  // 调用宿主工具
  function callParent(toolName, params) {
    return new Promise((resolve, reject) => {
      const callId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      pendingCalls.set(callId, { resolve, reject });
      parent.postMessage({ type: 'tool_call', callId, toolName, params }, '*');
    });
  }
  
  // 监听宿主返回的结果
  window.addEventListener('message', (event) => {
    const { callId, result, error } = event.data;
    if (callId && pendingCalls.has(callId)) {
      const { resolve, reject } = pendingCalls.get(callId);
      pendingCalls.delete(callId);
      if (error) reject(new Error(error));
      else resolve(result);
    }
  });
  
  // 暴露给用户代码的 tools 对象
  const tools = {
    getStateContent: (path) => callParent('get_state_content', { path }),
    setStateContent: (path, value) => callParent('setStateContent', { path, value }),
    getMemory: (ids) => callParent('get_memory_content', { ids }),
    saveMemory: (params) => callParent('save_memory', params),
  };
  
  // 捕获 console.log
  const consoleLogs = [];
  const originalLog = console.log;
  console.log = function(...args) {
    consoleLogs.push(args.map(a => {
      try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      } catch {
        return String(a);
      }
    }).join(' '));
    originalLog.apply(console, args);
  };
  
  // 执行用户代码
  try {
    const userFunction = new Function('tools', \`
      return (async () => {
        \${escapedCode}
      })();
    \`);
    
    const result = await userFunction(tools);
    
    parent.postMessage({
      type: 'execution_complete',
      result: result,
      logs: consoleLogs
    }, '*');
  } catch (err) {
    parent.postMessage({
      type: 'execution_error',
      error: err.message || String(err),
      logs: consoleLogs
    }, '*');
  }
})();
<\/script>
</body>
</html>
    `.trim()
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe)
    }
    this.iframe = null
  }

  /**
   * 销毁执行器
   */
  destroy(): void {
    this.cleanup()
  }
}

// 导出单例
export const sandboxExecutor = new SandboxExecutor()
