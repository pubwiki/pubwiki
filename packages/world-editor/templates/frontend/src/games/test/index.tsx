import { useState, useEffect } from 'react'
import type { GetGameOverviewRAGInput, CreativeWritingStreamInput, CreativeWritingOutput, CreativeWritingStreamCallback } from '../../api/types'
import { showAlert } from '../../components/AlertDialog'
import './test.css'

interface TestGameProps {
  onBack: () => void
}

interface ResourceInfo {
  path: string
  length: number
  content: string
}

interface ResourceStats {
  serviceName: string
  resources: ResourceInfo[]
  totalLength: number
  count: number
}

interface StreamEvent {
  timestamp: string
  event_type: string
  data: any
}

export default function TestGame({ onBack }: TestGameProps) {
  // LocalStorage keys
  const STORAGE_KEYS = {
    prompt: 'test-game-prompt',
    withSystemDocs: 'test-game-with-system-docs',
    streamCreateRequest: 'test-game-stream-create-request',
    streamThinkingInstruction: 'test-game-stream-thinking-instruction',
    streamPreviousContent: 'test-game-stream-previous-content',
    streamOutputSchema: 'test-game-stream-output-schema',
    luaCode: 'test-game-lua-code'
  }

  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [resourceStats, setResourceStats] = useState<ResourceStats | null>(null)
  const [loadingResource, setLoadingResource] = useState<string | null>(null)
  const [expandedResourceIndex, setExpandedResourceIndex] = useState<number | null>(null)
  
  // GetGameOverviewRAGNEXT 相关状态
  const [nextLoading, setNextLoading] = useState(false)
  const [nextResult, setNextResult] = useState<any>(null)
  const [withSystemDocs, setWithSystemDocs] = useState(false)

  // CreativeWritingStream 相关状态
  const [streamLoading, setStreamLoading] = useState(false)
  const [streamCreateRequest, setStreamCreateRequest] = useState('请写一段关于修仙者突破境界的场景描写，要有紧张感和仪式感')
  const [streamThinkingInstruction, setStreamThinkingInstruction] = useState('思考如何营造氛围，如何描写修炼者的心理变化')
  const [streamPreviousContent, setStreamPreviousContent] = useState('主角刚刚获得了一本古老的功法秘籍')
  const [streamOutputSchema, setStreamOutputSchema] = useState('{ scene: string // 场景描写, inner_thought: string // 内心独白 }')
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([])
  const [streamFinalResult, setStreamFinalResult] = useState<Partial<CreativeWritingOutput> | null>(null)

  // Lua 调试器相关状态
  const [luaCode, setLuaCode] = useState('print("Hello, Lua!")\nreturn 1 + 2')
  const [luaLoading, setLuaLoading] = useState(false)
  const [luaResult, setLuaResult] = useState<{ success: boolean; result?: any; output?: string; error?: string } | null>(null)

  // 从 localStorage 加载数据
  useEffect(() => {
    const savedPrompt = localStorage.getItem(STORAGE_KEYS.prompt)
    const savedWithSystemDocs = localStorage.getItem(STORAGE_KEYS.withSystemDocs)
    const savedStreamCreateRequest = localStorage.getItem(STORAGE_KEYS.streamCreateRequest)
    const savedStreamThinkingInstruction = localStorage.getItem(STORAGE_KEYS.streamThinkingInstruction)
    const savedStreamPreviousContent = localStorage.getItem(STORAGE_KEYS.streamPreviousContent)
    const savedStreamOutputSchema = localStorage.getItem(STORAGE_KEYS.streamOutputSchema)

    if (savedPrompt) setPrompt(savedPrompt)
    if (savedWithSystemDocs) setWithSystemDocs(savedWithSystemDocs === 'true')
    if (savedStreamCreateRequest) setStreamCreateRequest(savedStreamCreateRequest)
    if (savedStreamThinkingInstruction) setStreamThinkingInstruction(savedStreamThinkingInstruction)
    if (savedStreamPreviousContent) setStreamPreviousContent(savedStreamPreviousContent)
    if (savedStreamOutputSchema) setStreamOutputSchema(savedStreamOutputSchema)

    const savedLuaCode = localStorage.getItem(STORAGE_KEYS.luaCode)
    if (savedLuaCode) setLuaCode(savedLuaCode)
  }, [])

  // 保存到 localStorage
  const saveToLocalStorage = (key: string, value: string | boolean) => {
    localStorage.setItem(key, String(value))
  }

  const handleTestRAG = async () => {
    if (!prompt.trim()) {
      showAlert('请输入测试提示词')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const input: GetGameOverviewRAGInput = {
        prompt: prompt.trim(),
        rag_config: {
          enable_auto_collector: true,
          with_entity_overview: true,
          with_component_types: true,
          with_systems_docs: true,
          with_setting_docs: true
        }
      }

      console.log('Calling GetGameOverviewRAG with:', input)
      const response = await window.callService('GameTemplate:GetGameOverviewRAG', input)
      console.log('GetGameOverviewRAG response:', response)
      
      setResult(response)
    } catch (e) {
      console.error('Failed to call GetGameOverviewRAG:', e)
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setPrompt('')
    setResult(null)
    setError(null)
  }

  const handleTestRAGNEXT = async () => {
    if (!prompt.trim()) {
      showAlert('请输入测试提示词')
      return
    }

    setNextLoading(true)
    setError(null)
    setNextResult(null)

    try {
      const input = {
        prompt: prompt.trim(),
        with_system_docs: withSystemDocs
      }

      console.log('Calling GetGameOverviewRAGNEXT with:', input)
      const response = await window.callService('GameTemplate:GetGameOverviewRAGNEXT', input)
      console.log('GetGameOverviewRAGNEXT response:', response)
      
      setNextResult(response)
    } catch (e) {
      console.error('Failed to call GetGameOverviewRAGNEXT:', e)
      setError((e as Error).message)
    } finally {
      setNextLoading(false)
    }
  }

  const handleClearNext = () => {
    setNextResult(null)
    setWithSystemDocs(false)
  }

  const handleTestCreativeWritingStream = async () => {
    if (!streamCreateRequest.trim()) {
      showAlert('请输入创意写作请求')
      return
    }

    setStreamLoading(true)
    setError(null)
    setStreamEvents([])
    setStreamFinalResult(null)

    try {
      const callback = (streamEvent:{event_type:string, event_data:unknown}) => {
        const timestamp = new Date().toLocaleTimeString()
        const { event_type, event_data } = streamEvent
        const newEvent: StreamEvent = {
          timestamp,
          event_type,
          data: event_data
        }

        console.log(`[${timestamp}] Stream Event:`, event_type, event_data)

        // 添加事件到列表
        setStreamEvents(prev => [...prev, newEvent])

        // 处理不同类型的事件
        if (event_type === 'error') {
          setError((event_data as Error).message || '未知错误')
        } else if (event_type === 'done') {
          setStreamFinalResult(event_data as Partial<CreativeWritingOutput>)
          setStreamLoading(false)
        } else if (event_type === 'result_update' || event_type === 'collector_result_update') {
          // 实时更新结果预览
          // 此时的event_data就是部分结果，但是不一定完整（注意，这里返回的结果不是一段一段的chunk文本，而是当前的最新结果(包含了之前的结果，所以千万不要重复累加)）
          setStreamFinalResult(event_data as Partial<CreativeWritingOutput>)
        }
      }
      const input: CreativeWritingStreamInput = {
        create_request: streamCreateRequest.trim(),
        thinking_instruction: streamThinkingInstruction.trim(),
        previous_content_overview: streamPreviousContent.trim(),
        output_content_schema: streamOutputSchema.trim(),
        callback: callback as CreativeWritingStreamCallback
      }

      console.log('Calling CreativeWritingStream with:', input)

      await window.callService('GameTemplate:CreativeWritingStream', input)

    } catch (e) {
      console.error('Failed to call CreativeWritingStream:', e)
      setError((e as Error).message)
      setStreamLoading(false)
    }
  }

  const handleClearStream = () => {
    setStreamEvents([])
    setStreamFinalResult(null)
    setError(null)
  }

  // Lua 调试器相关函数
  const handleExecuteLua = async () => {
    if (!luaCode.trim()) {
      showAlert('请输入 Lua 代码')
      return
    }

    setLuaLoading(true)
    setLuaResult(null)

    try {
      console.log('Calling test:ExecuteLuaCode with:', luaCode)
      const response = await window.callService('test:ExecuteLuaCode', { code: luaCode })
      console.log('test:ExecuteLuaCode response:', response)
      setLuaResult(response)
    } catch (e) {
      console.error('Failed to call test:ExecuteLuaCode:', e)
      setLuaResult({
        success: false,
        error: (e as Error).message
      })
    } finally {
      setLuaLoading(false)
    }
  }

  const handleClearLua = () => {
    setLuaResult(null)
  }

  const handleTestResource = async (serviceName: string, serviceCall: string) => {
    setLoadingResource(serviceName)
    setError(null)
    setResourceStats(null)
    setExpandedResourceIndex(null)

    try {
      console.log(`Calling ${serviceCall}`)
      const response = await window.callService(serviceCall, {})
      console.log(`${serviceCall} response:`, response)
      
      if (!response.resources && !response.data) {
        setError(`服务 ${serviceCall} 返回数据格式错误`)
        return
      }

      const resources = response.resources || response.data || []
      const resourceInfos: ResourceInfo[] = resources.map((res: any) => {
        const pathStr = Array.isArray(res.path) ? res.path.join('/') : res.path || '未知路径'
        return {
          path: pathStr,
          length: res.content ? res.content.length : 0,
          content: res.content || ''
        }
      })

      const totalLength = resourceInfos.reduce((sum, r) => sum + r.length, 0)

      setResourceStats({
        serviceName,
        resources: resourceInfos,
        totalLength,
        count: resourceInfos.length
      })
    } catch (e) {
      console.error(`Failed to call ${serviceCall}:`, e)
      setError((e as Error).message)
    } finally {
      setLoadingResource(null)
    }
  }

  return (
    <div className="test-game-view">
      <div className="test-header">
        <button className="btn-back" onClick={onBack}>← 返回</button>
        <h1>测试工具</h1>
      </div>

      <div className="test-content">
        <div className="test-panel">
          <h2>RAG 概览功能测试</h2>
          
          <div className="test-input-section">
            <label htmlFor="prompt-input">测试提示词：</label>
            <textarea
              id="prompt-input"
              className="test-textarea"
              value={prompt}
              onChange={(e) => {
                const value = e.target.value
                setPrompt(value)
                saveToLocalStorage(STORAGE_KEYS.prompt, value)
              }}
              placeholder="输入你的测试提示词，例如：请介绍一下当前游戏世界的基本信息"
              rows={6}
              disabled={loading}
            />
          </div>

          <div className="test-actions">
            <button 
              className="btn-test primary"
              onClick={handleTestRAG}
              disabled={loading || !prompt.trim()}
            >
              {loading ? '测试中...' : '测试 RAG 概览功能'}
            </button>
            <button 
              className="btn-clear"
              onClick={handleClear}
              disabled={loading}
            >
              清空
            </button>
          </div>

          {error && (
            <div className="test-error">
              <h3>错误</h3>
              <pre>{error}</pre>
            </div>
          )}

          {result && (
            <div className="test-result">
              <h3>返回结果</h3>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>

        <div className="test-panel">
          <h2>RAG 概览功能测试 NEXT (智能收集器)</h2>
          
          <div className="test-input-section">
            <label htmlFor="prompt-input-next">测试提示词：</label>
            <textarea
              id="prompt-input-next"
              className="test-textarea"
              value={prompt}
              onChange={(e) => {
                const value = e.target.value
                setPrompt(value)
                saveToLocalStorage(STORAGE_KEYS.prompt, value)
              }}
              placeholder="输入你的测试提示词，例如：请介绍一下当前游戏世界的基本信息"
              rows={6}
              disabled={nextLoading}
            />
          </div>

          <div className="test-checkbox-section">
            <label>
              <input
                type="checkbox"
                checked={withSystemDocs}
                onChange={(e) => {
                  const checked = e.target.checked
                  setWithSystemDocs(checked)
                  saveToLocalStorage(STORAGE_KEYS.withSystemDocs, checked)
                }}
                disabled={nextLoading}
              />
              包含系统服务相关文档
            </label>
          </div>

          <div className="test-actions">
            <button 
              className="btn-test primary"
              onClick={handleTestRAGNEXT}
              disabled={nextLoading || !prompt.trim()}
            >
              {nextLoading ? '测试中...' : '测试 RAG NEXT (智能收集)'}
            </button>
            <button 
              className="btn-clear"
              onClick={handleClearNext}
              disabled={nextLoading}
            >
              清空结果
            </button>
          </div>

          {nextResult && (
            <div className="test-result">
              <h3>返回结果</h3>
              
              <div className="result-section">
                <h4>概览文本</h4>
                <div className="overview-text">
                  <pre>{nextResult.overview_text || '无内容'}</pre>
                </div>
              </div>

              {nextResult.collector_results && nextResult.collector_results.length > 0 && (
                <div className="result-section">
                  <h4>收集器决策结果</h4>
                  <div className="collector-results">
                    {nextResult.collector_results.map((item: any, index: number) => (
                      <div key={index} className={`collector-item ${item.selected ? 'selected' : 'rejected'}`}>
                        <div className="collector-header">
                          <span className="entity-id">
                            {item.selected ? '' : ''} {item.entity_id}
                          </span>
                        </div>
                        <div className="collector-reason">
                          <strong>原因：</strong>{item.reason}
                        </div>
                        {item.documents && item.documents.length > 0 && (
                          <div className="documents-list">
                            <strong>文档决策：</strong>
                            <ul>
                              {item.documents.map((doc: any, docIndex: number) => (
                                <li key={docIndex} className={doc.selected ? 'doc-selected' : 'doc-rejected'}>
                                  {doc.selected ? '' : ''} {doc.id} - {doc.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="result-section">
                <h4>完整 JSON 数据</h4>
                <pre>{JSON.stringify(nextResult, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>

        <div className="test-panel">
          <h2>CreativeWritingStream 流式创意写作测试</h2>
          
          <div className="test-input-section">
            <label htmlFor="stream-create-request">创意写作请求：</label>
            <textarea
              id="stream-create-request"
              className="test-textarea"
              value={streamCreateRequest}
              onChange={(e) => {
                const value = e.target.value
                setStreamCreateRequest(value)
                saveToLocalStorage(STORAGE_KEYS.streamCreateRequest, value)
              }}
              placeholder="输入你的创意写作请求，例如：请写一段关于修仙者突破境界的场景描写"
              rows={3}
              disabled={streamLoading}
            />
          </div>

          <div className="test-input-section">
            <label htmlFor="stream-thinking">思考指令：</label>
            <textarea
              id="stream-thinking"
              className="test-textarea"
              value={streamThinkingInstruction}
              onChange={(e) => {
                const value = e.target.value
                setStreamThinkingInstruction(value)
                saveToLocalStorage(STORAGE_KEYS.streamThinkingInstruction, value)
              }}
              placeholder="输入思考指令，例如：思考如何营造氛围"
              rows={2}
              disabled={streamLoading}
            />
          </div>

          <div className="test-input-section">
            <label htmlFor="stream-previous">之前内容概览：</label>
            <textarea
              id="stream-previous"
              className="test-textarea"
              value={streamPreviousContent}
              onChange={(e) => {
                const value = e.target.value
                setStreamPreviousContent(value)
                saveToLocalStorage(STORAGE_KEYS.streamPreviousContent, value)
              }}
              placeholder="输入之前的内容概览，例如：主角刚刚获得了一本古老的功法秘籍"
              rows={2}
              disabled={streamLoading}
            />
          </div>

          <div className="test-input-section">
            <label htmlFor="stream-schema">输出内容结构：</label>
            <textarea
              id="stream-schema"
              className="test-textarea"
              value={streamOutputSchema}
              onChange={(e) => {
                const value = e.target.value
                setStreamOutputSchema(value)
                saveToLocalStorage(STORAGE_KEYS.streamOutputSchema, value)
              }}
              placeholder="输入输出结构，例如：{ scene: string, inner_thought: string }"
              rows={2}
              disabled={streamLoading}
            />
          </div>

          <div className="test-actions">
            <button 
              className="btn-test primary"
              onClick={handleTestCreativeWritingStream}
              disabled={streamLoading || !streamCreateRequest.trim()}
            >
              {streamLoading ? '生成中...' : '开始流式创意写作'}
            </button>
            <button 
              className="btn-clear"
              onClick={handleClearStream}
              disabled={streamLoading}
            >
              清空结果
            </button>
          </div>

          {streamEvents.length > 0 && (
            <div className="test-result">
              <h3>流式事件记录 ({streamEvents.length} 条)</h3>
              <div className="stream-events">
                {streamEvents.map((event, index) => (
                  <div key={index} className={`stream-event event-${event.event_type}`}>
                    <div className="event-header">
                      <span className="event-time">{event.timestamp}</span>
                      <span className="event-type">{event.event_type}</span>
                    </div>
                    <div className="event-data">
                      <pre>{JSON.stringify(event.data, null, 2)}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {streamFinalResult && (
            <div className="test-result">
              <h3>最终结果</h3>
              
              {streamFinalResult.thinking && (
                <div className="result-section">
                  <h4>思考过程</h4>
                  <pre>{streamFinalResult.thinking}</pre>
                </div>
              )}

              {streamFinalResult.content && (
                <div className="result-section">
                  <h4>生成内容</h4>
                  <pre>{JSON.stringify(streamFinalResult.content, null, 2)}</pre>
                </div>
              )}

              {streamFinalResult.collector_results && streamFinalResult.collector_results.length > 0 && (
                <div className="result-section">
                  <h4>收集器结果</h4>
                  <div className="collector-results">
                    {streamFinalResult.collector_results.map((item: any, index: number) => (
                      <div key={index} className={`collector-item ${item.selected ? 'selected' : 'rejected'}`}>
                        <div className="collector-header">
                          <span className="entity-id">
                            {item.selected ? '' : ''} {item.entity_id}
                          </span>
                        </div>
                        <div className="collector-reason">
                          <strong>思考：</strong>{item.thinking}
                        </div>
                        {item.documents && item.documents.length > 0 && (
                          <div className="documents-list">
                            <strong>文档决策：</strong>
                            <ul>
                              {item.documents.map((doc: any, docIndex: number) => (
                                <li key={docIndex} className={doc.selected ? 'doc-selected' : 'doc-rejected'}>
                                  {doc.selected ? '' : ''} {doc.path} - {doc.thinking}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {streamFinalResult.raw_text && (
                <div className="result-section">
                  <h4>原始文本</h4>
                  <pre>{streamFinalResult.raw_text}</pre>
                </div>
              )}

              <div className="result-section">
                <h4>完整 JSON 数据</h4>
                <pre>{JSON.stringify(streamFinalResult, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>

        <div className="test-panel">
          <h2>Lua 调试器</h2>
          
          <div className="test-input-section">
            <label htmlFor="lua-code">Lua 代码：</label>
            <textarea
              id="lua-code"
              className="test-textarea lua-code-input"
              value={luaCode}
              onChange={(e) => {
                const value = e.target.value
                setLuaCode(value)
                saveToLocalStorage(STORAGE_KEYS.luaCode, value)
              }}
              placeholder="输入 Lua 代码，例如：print('Hello')\nreturn 1 + 2"
              rows={10}
              disabled={luaLoading}
              spellCheck={false}
            />
          </div>

          <div className="test-actions">
            <button 
              className="btn-test primary"
              onClick={handleExecuteLua}
              disabled={luaLoading || !luaCode.trim()}
            >
              {luaLoading ? '执行中...' : '▶执行代码'}
            </button>
            <button 
              className="btn-clear"
              onClick={handleClearLua}
              disabled={luaLoading}
            >
              清空结果
            </button>
          </div>

          {luaResult && (
            <div className={`test-result ${luaResult.success ? 'success' : 'error'}`}>
              <h3>{luaResult.success ? '执行成功' : '执行失败'}</h3>
              
              {luaResult.output && (
                <div className="result-section">
                  <h4>输出 (print)</h4>
                  <pre className="lua-output">{luaResult.output}</pre>
                </div>
              )}

              {luaResult.result !== undefined && luaResult.result !== null && (
                <div className="result-section">
                  <h4>返回值</h4>
                  <pre className="lua-return">{
                    typeof luaResult.result === 'object' 
                      ? JSON.stringify(luaResult.result, null, 2)
                      : String(luaResult.result)
                  }</pre>
                </div>
              )}

              {luaResult.error && (
                <div className="result-section">
                  <h4>错误信息</h4>
                  <pre className="lua-error">{luaResult.error}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="test-panel">
          <h2>资源统计测试</h2>
          
          <div className="resource-buttons">
            <button
              className="btn-resource"
              onClick={() => handleTestResource('组件类型', 'ecs:ComponentTypes')}
              disabled={loadingResource !== null}
            >
              {loadingResource === '组件类型' ? '加载中...' : '组件类型'}
            </button>
            <button
              className="btn-resource"
              onClick={() => handleTestResource('实体概览', 'ecs:WorldOverview')}
              disabled={loadingResource !== null}
            >
              {loadingResource === '实体概览' ? '加载中...' : '实体概览'}
            </button>
            <button
              className="btn-resource"
              onClick={() => handleTestResource('系统服务', 'ecs:SystemServices')}
              disabled={loadingResource !== null}
            >
              {loadingResource === '系统服务' ? '加载中...' : '系统服务'}
            </button>
            <button
              className="btn-resource"
              onClick={() => handleTestResource('设定文档', 'state:GetSettingDocsResource')}
              disabled={loadingResource !== null}
            >
              {loadingResource === '设定文档' ? '加载中...' : '设定文档'}
            </button>
          </div>

          {resourceStats && (
            <div className="resource-stats">
              <h3>{resourceStats.serviceName} - 统计结果</h3>
              <div className="stats-summary">
                <div className="stat-item">
                  <span className="stat-label">资源数量：</span>
                  <span className="stat-value">{resourceStats.count}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">总长度：</span>
                  <span className="stat-value highlight">{resourceStats.totalLength.toLocaleString()} 字符</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">平均长度：</span>
                  <span className="stat-value">
                    {resourceStats.count > 0 ? Math.round(resourceStats.totalLength / resourceStats.count).toLocaleString() : 0} 字符
                  </span>
                </div>
              </div>
              
              <div className="resources-list">
                <h4>资源列表 (点击查看内容)</h4>
                <div className="resources-table">
                  {resourceStats.resources.map((res, index) => (
                    <div key={index} className="resource-item">
                      <div 
                        className={`resource-row ${expandedResourceIndex === index ? 'expanded' : ''}`}
                        onClick={() => setExpandedResourceIndex(expandedResourceIndex === index ? null : index)}
                      >
                        <div className="resource-index">{index + 1}</div>
                        <div className="resource-path" title={res.path}>{res.path}</div>
                        <div className="resource-length">{res.length.toLocaleString()} 字符</div>
                        <div className="resource-toggle">
                          {expandedResourceIndex === index ? '▼' : '▶'}
                        </div>
                      </div>
                      {expandedResourceIndex === index && (
                        <div className="resource-content">
                          <pre>{res.content}</pre>
                        </div>
                      )}
                      <div className="resource-length">{res.length.toLocaleString()} 字符</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
