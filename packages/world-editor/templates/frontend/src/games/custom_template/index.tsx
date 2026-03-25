/**
 * Custom Template — 极简示例游戏
 *
 * 本文件演示游戏引擎的三大核心 API：
 *   1. 数据获取 — getGameState / getPlayerEntity / getNPCEntities
 *   2. 流式创意写作 — creativeWritingStream
 *   3. 游戏状态更新 — updateGameStateAndDocs
 *
 * 完全自包含，不依赖 games/components、Zustand、i18next 或任何 CSS 文件。
 * 适合作为用户自定义游戏前端的起点。
 */

import { useState } from 'react'

// ── 类型化服务 API（唯一外部依赖）──────────────────────────────
import {
  getGameState,
  getPlayerEntity,
  getNPCEntities,
  creativeWritingStream,
  updateGameStateAndDocs,
  createSave,
  loadSave,
  listSaves,
} from '../utils'

import type {
  StateData,
  PlayerEntityOutput,
  NPCEntitiesOutput,
  CreativeWritingOutput,
  UpdateGameStateAndDocsOutput,
  CreateGameSaveOutput,
  ListGameSavesOutput,
} from '../../api/types'

// ── Props ──────────────────────────────────────────────────────
interface CustomTemplateProps {
  onBack: () => void
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export default function CustomTemplateGame({ onBack }: CustomTemplateProps) {
  // ── Section 1: 数据获取 ──────────────────────────────────────
  const [gameState, setGameState] = useState<StateData | null>(null)
  const [player, setPlayer] = useState<PlayerEntityOutput | null>(null)
  const [npcs, setNpcs] = useState<NPCEntitiesOutput | null>(null)

  // ── Section 2: 创意写作 ──────────────────────────────────────
  const [createRequest, setCreateRequest] = useState('写一段简短的冒险故事开头')
  const [thinkingInstruction, setThinkingInstruction] = useState('思考角色当前的处境和可能的发展')
  const [previousOverview, setPreviousOverview] = useState('')
  const [outputSchema, setOutputSchema] = useState('string')
  const [streamContent, setStreamContent] = useState('')
  const [streamReasoning, setStreamReasoning] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [streamStatus, setStreamStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const [streamError, setStreamError] = useState('')
  const [lastResult, setLastResult] = useState<CreativeWritingOutput | null>(null)

  // ── Section 3: 状态更新 ──────────────────────────────────────
  const [newEvent, setNewEvent] = useState('')
  const [stateChangesText, setStateChangesText] = useState('')
  const [settingChangesText, setSettingChangesText] = useState('')
  const [updateResult, setUpdateResult] = useState<UpdateGameStateAndDocsOutput | null>(null)
  const [updating, setUpdating] = useState(false)

  // ── Section 4: 存档 ──────────────────────────────────────────
  const [saves, setSaves] = useState<ListGameSavesOutput | null>(null)
  const [lastSave, setLastSave] = useState<CreateGameSaveOutput | null>(null)

  // ── 通用加载状态 ─────────────────────────────────────────────
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  const setLoadingKey = (key: string, value: boolean) =>
    setLoading(prev => ({ ...prev, [key]: value }))

  // ═════════════════════════════════════════════════════════════
  // Section 1: 数据获取处理函数
  // ═════════════════════════════════════════════════════════════

  const handleLoadGameState = async () => {
    setLoadingKey('gameState', true)
    try {
      const result = await getGameState()
      if (result.success && result.data) {
        setGameState(result.data)
      }
    } catch (e) {
      console.error('Failed to load game state:', e)
    }
    setLoadingKey('gameState', false)
  }

  const handleLoadPlayer = async () => {
    setLoadingKey('player', true)
    try {
      const result = await getPlayerEntity()
      setPlayer(result)
    } catch (e) {
      console.error('Failed to load player:', e)
    }
    setLoadingKey('player', false)
  }

  const handleLoadNPCs = async () => {
    setLoadingKey('npcs', true)
    try {
      const result = await getNPCEntities()
      setNpcs(result)
    } catch (e) {
      console.error('Failed to load NPCs:', e)
    }
    setLoadingKey('npcs', false)
  }

  // ═════════════════════════════════════════════════════════════
  // Section 2: 创意写作流式生成
  // ═════════════════════════════════════════════════════════════

  const handleCreativeWrite = async () => {
    // 重置状态
    setStreamContent('')
    setStreamReasoning('')
    setStreamThinking('')
    setStreamError('')
    setStreamStatus('streaming')
    setLastResult(null)

    try {
      await creativeWritingStream({
        create_request: createRequest,
        thinking_instruction: thinkingInstruction,
        previous_content_overview: previousOverview,
        output_content_schema: outputSchema,

        // 流式回调 — 这是核心：根据 event_type 处理不同阶段的数据
        callback: (streamEvent) => {
          const { event_type, event_data } = streamEvent

          switch (event_type) {
            // RAG 收集器更新：展示从设定文档中检索到的相关内容
            case 'collector_result_update': {
              const data = event_data as Partial<CreativeWritingOutput>
              if (data.collector_results) {
                setStreamReasoning(
                  `[RAG 收集] 找到 ${data.collector_results.length} 个相关实体`
                )
              }
              break
            }

            // 推理更新：展示 LLM 的推理过程
            case 'reasoning_update': {
              const data = event_data as Partial<CreativeWritingOutput>
              if (data.reasoning) setStreamReasoning(data.reasoning)
              if (data.collector_results) {
                // collector_results 也可能随 reasoning_update 一起到达
              }
              break
            }

            // 结果增量更新：流式接收生成的内容
            case 'result_update': {
              const data = event_data as Partial<CreativeWritingOutput>
              if (data.content !== undefined) {
                // content 的类型取决于 output_content_schema
                // schema 为 "string" 时 content 就是字符串
                // schema 为对象时 content 是对应的对象（流式中可能是部分数据）
                setStreamContent(
                  typeof data.content === 'string'
                    ? data.content
                    : JSON.stringify(data.content, null, 2)
                )
              }
              if (data.thinking) setStreamThinking(data.thinking)
              break
            }

            // 生成完成：获取最终结果，含 state_changes 和 setting_changes
            case 'done': {
              const data = event_data as Partial<CreativeWritingOutput>
              setStreamStatus('done')
              setLastResult(data as CreativeWritingOutput)

              // 自动填充到 Section 3 的输入框，方便用户直接更新状态
              if (data.content) {
                setNewEvent(
                  typeof data.content === 'string'
                    ? data.content.slice(0, 200)
                    : JSON.stringify(data.content).slice(0, 200)
                )
              }
              if (data.state_changes?.length) {
                setStateChangesText(data.state_changes.join('\n'))
              }
              if (data.setting_changes?.length) {
                setSettingChangesText(data.setting_changes.join('\n'))
              }
              break
            }

            // 错误处理
            case 'error': {
              const err = event_data as Error
              setStreamStatus('error')
              setStreamError(err.message || String(err))
              break
            }
          }
        },
      })
    } catch (e: any) {
      setStreamStatus('error')
      setStreamError(e.message || String(e))
    }
  }

  // ═════════════════════════════════════════════════════════════
  // Section 3: 更新游戏状态
  // ═════════════════════════════════════════════════════════════

  const handleUpdateState = async () => {
    setUpdating(true)
    setUpdateResult(null)
    try {
      const result = await updateGameStateAndDocs({
        new_event: newEvent,
        state_changes: stateChangesText.split('\n').filter(Boolean),
        setting_changes: settingChangesText.split('\n').filter(Boolean),
      })
      setUpdateResult(result)
    } catch (e: any) {
      setUpdateResult({ success: false, error: e.message || String(e) })
    }
    setUpdating(false)
  }

  // ═════════════════════════════════════════════════════════════
  // Section 4: 存档管理
  // ═════════════════════════════════════════════════════════════

  const handleCreateSave = async () => {
    setLoadingKey('save', true)
    try {
      const result = await createSave({ title: 'Custom Template Save' })
      setLastSave(result)
    } catch (e) {
      console.error('Failed to create save:', e)
    }
    setLoadingKey('save', false)
  }

  const handleListSaves = async () => {
    setLoadingKey('saves', true)
    try {
      const result = await listSaves()
      setSaves(result)
    } catch (e) {
      console.error('Failed to list saves:', e)
    }
    setLoadingKey('saves', false)
  }

  const handleLoadSave = async (checkpointId: string) => {
    setLoadingKey('loadSave', true)
    try {
      await loadSave(checkpointId)
      // 重新加载数据以反映存档状态
      await handleLoadGameState()
      await handleLoadPlayer()
    } catch (e) {
      console.error('Failed to load save:', e)
    }
    setLoadingKey('loadSave', false)
  }

  // ═════════════════════════════════════════════════════════════
  // 渲染
  // ═════════════════════════════════════════════════════════════

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={onBack}>← Back</button>
        <h1 style={{ margin: 0 }}>Custom Template Game</h1>
      </div>

      {/* ════════════════════════════════════════════════════════
          Section 1: 数据获取
          ════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 32 }}>
        <h2>1. 数据获取 (Game Data)</h2>
        <p style={{ color: '#666' }}>
          演示如何获取游戏中的各类数据：世界状态、玩家、NPC、地域、组织等。
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={handleLoadGameState} disabled={loading.gameState}>
            {loading.gameState ? '加载中...' : '📦 加载游戏状态'}
          </button>
          <button onClick={handleLoadPlayer} disabled={loading.player}>
            {loading.player ? '加载中...' : '🧑 加载玩家'}
          </button>
          <button onClick={handleLoadNPCs} disabled={loading.npcs}>
            {loading.npcs ? '加载中...' : '👥 加载 NPC'}
          </button>
        </div>

        {/* 游戏状态概览 */}
        {gameState && (
          <details open>
            <summary><strong>GameState (World / Regions / Organizations)</strong></summary>

            <h4>World</h4>
            <JsonBlock data={gameState.World} />

            {gameState.Regions && (
              <>
                <h4>Regions ({gameState.Regions.length})</h4>
                <JsonBlock data={gameState.Regions} />
              </>
            )}

            {gameState.Organizations && (
              <>
                <h4>Organizations ({gameState.Organizations.length})</h4>
                <JsonBlock data={gameState.Organizations} />
              </>
            )}

            {gameState.Creatures && (
              <>
                <h4>Creatures ({gameState.Creatures.length})</h4>
                <JsonBlock data={gameState.Creatures} />
              </>
            )}
          </details>
        )}

        {/* 玩家实体 */}
        {player && (
          <details open>
            <summary>
              <strong>Player Entity</strong>
              {player.Creature?.name && ` — ${player.Creature.name}`}
            </summary>
            <JsonBlock data={player} />
          </details>
        )}

        {/* NPC 列表 */}
        {npcs && (
          <details open>
            <summary><strong>NPCs ({npcs.count})</strong></summary>
            <JsonBlock data={npcs} />
          </details>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════
          Section 2: 创意写作流式生成
          ════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 32 }}>
        <h2>2. CreativeWritingStream (流式创意写作)</h2>
        <p style={{ color: '#666' }}>
          演示如何调用 LLM 流式生成内容。引擎会自动进行 RAG 检索相关设定文档。
        </p>

        {/* 创作请求 */}
        <label>
          <strong>create_request</strong> — 创作请求（告诉 LLM 写什么）
        </label>
        <textarea
          value={createRequest}
          onChange={e => setCreateRequest(e.target.value)}
          rows={3}
          style={{ width: '100%', marginBottom: 8 }}
        />

        {/* 思考指令 */}
        <label>
          <strong>thinking_instruction</strong> — 思考指令（引导 LLM 如何思考）
        </label>
        <textarea
          value={thinkingInstruction}
          onChange={e => setThinkingInstruction(e.target.value)}
          rows={2}
          style={{ width: '100%', marginBottom: 8 }}
        />

        {/* 之前内容概览 */}
        <label>
          <strong>previous_content_overview</strong> — 之前内容概览（上下文摘要）
        </label>
        <textarea
          value={previousOverview}
          onChange={e => setPreviousOverview(e.target.value)}
          rows={2}
          style={{ width: '100%', marginBottom: 8 }}
        />

        {/* 输出 schema */}
        <label>
          <strong>output_content_schema</strong> — 输出结构定义
          <span style={{ color: '#999', marginLeft: 8 }}>
            例: "string" 或 {`"{title: string, content: string}"`}
          </span>
        </label>
        <input
          value={outputSchema}
          onChange={e => setOutputSchema(e.target.value)}
          style={{ width: '100%', marginBottom: 12 }}
        />

        <button
          onClick={handleCreativeWrite}
          disabled={streamStatus === 'streaming' || !createRequest.trim()}
        >
          {streamStatus === 'streaming' ? '⏳ 生成中...' : '✨ 开始生成'}
        </button>

        {/* 流式输出展示 */}
        {streamStatus !== 'idle' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, color: streamStatus === 'error' ? 'red' : '#333' }}>
              状态: <strong>{streamStatus}</strong>
            </div>

            {streamError && (
              <div style={{ color: 'red', marginBottom: 8 }}>
                错误: {streamError}
              </div>
            )}

            {streamReasoning && (
              <details>
                <summary>Reasoning / RAG</summary>
                <pre style={preStyle}>{streamReasoning}</pre>
              </details>
            )}

            {streamThinking && (
              <details>
                <summary>Thinking</summary>
                <pre style={preStyle}>{streamThinking}</pre>
              </details>
            )}

            {streamContent && (
              <>
                <strong>生成内容:</strong>
                <pre style={preStyle}>{streamContent}</pre>
              </>
            )}

            {lastResult && (
              <details>
                <summary>完整结果 (含 state_changes / setting_changes)</summary>
                <JsonBlock data={lastResult} />
              </details>
            )}
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════
          Section 3: 更新游戏状态
          ════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 32 }}>
        <h2>3. UpdateGameStateAndDocs (更新游戏状态)</h2>
        <p style={{ color: '#666' }}>
          将新事件和状态变更发送给引擎，引擎会自动生成并执行 Lua 代码来更新 ECS。
          通常在 CreativeWritingStream 完成后调用。
        </p>

        <label><strong>new_event</strong> — 新发生的事件描述</label>
        <textarea
          value={newEvent}
          onChange={e => setNewEvent(e.target.value)}
          rows={3}
          style={{ width: '100%', marginBottom: 8 }}
        />

        <label>
          <strong>state_changes</strong> — 状态变化列表（每行一条）
        </label>
        <textarea
          value={stateChangesText}
          onChange={e => setStateChangesText(e.target.value)}
          rows={3}
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="玩家获得了 10 经验值&#10;NPC 张三好感度 +5"
        />

        <label>
          <strong>setting_changes</strong> — 设定变更列表（每行一条）
        </label>
        <textarea
          value={settingChangesText}
          onChange={e => setSettingChangesText(e.target.value)}
          rows={2}
          style={{ width: '100%', marginBottom: 12 }}
          placeholder="新增地点: 黑暗森林深处的古老神殿"
        />

        <button
          onClick={handleUpdateState}
          disabled={updating || !newEvent.trim()}
        >
          {updating ? '⏳ 更新中...' : '🔄 更新游戏状态'}
        </button>

        {updateResult && (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: updateResult.success ? 'green' : 'red', marginBottom: 8 }}>
              {updateResult.success ? '✅ 更新成功' : `❌ 更新失败: ${updateResult.error}`}
            </div>
            <details open>
              <summary>更新结果详情</summary>
              <JsonBlock data={updateResult} />
            </details>
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════
          Section 4: 存档管理
          ════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 32 }}>
        <h2>4. 存档管理 (Save / Load)</h2>
        <p style={{ color: '#666' }}>
          演示存档的创建、列表和加载。
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={handleCreateSave} disabled={loading.save}>
            {loading.save ? '保存中...' : '💾 创建存档'}
          </button>
          <button onClick={handleListSaves} disabled={loading.saves}>
            {loading.saves ? '加载中...' : '📋 列出存档'}
          </button>
        </div>

        {lastSave && (
          <div style={{ marginBottom: 8 }}>
            最新存档: <code>{(lastSave as any).checkpoint_id || JSON.stringify(lastSave)}</code>
          </div>
        )}

        {saves && (
          <details open>
            <summary>存档列表</summary>
            <JsonBlock data={saves} />
          </details>
        )}
      </section>
    </div>
  )
}

// ── 工具组件 ────────────────────────────────────────────────────

/** 简单的 JSON 展示块 */
function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre style={preStyle}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

const preStyle: React.CSSProperties = {
  background: '#f5f5f5',
  padding: 12,
  borderRadius: 4,
  overflow: 'auto',
  maxHeight: 400,
  fontSize: 12,
  lineHeight: 1.4,
}
