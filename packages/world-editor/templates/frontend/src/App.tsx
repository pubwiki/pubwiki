import { useState, useEffect, useRef, useCallback } from 'react'
import { usePub } from '@pubwiki/game-sdk'
import {
  useGameData,
  useNarrative,
  StreamText,
  Player,
  Creature,
  Region,
  Org,
  PlayerPanel,
  NPCList,
  RegionList,
  OrgList,
  WorldPanel,
} from '@pubwiki/game-ui'
import type { StoryHistory, GenerateResult, UpdateResult } from '@pubwiki/game-ui'
import './App.css'

type Tab = 'story' | 'data' | 'player' | 'creatures' | 'regions' | 'organizations' | 'world' | 'console'

const TAB_LABELS: Record<Tab, string> = {
  story: '剧情',
  data: '数据',
  player: '主角',
  creatures: '角色',
  regions: '地域',
  organizations: '势力',
  world: '世界',
  console: '控制台',
}

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="tab-bar">
      {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
        <button key={t} className={`tab-btn ${active === t ? 'active' : ''}`} onClick={() => onChange(t)}>
          {TAB_LABELS[t]}
        </button>
      ))}
    </nav>
  )
}

// ── Story Tab — 典型小说生成循环示例 ──

/** 生成内容的 output_content_schema */
const CONTENT_SCHEMA = `{ novel_content: string }`

/** 为 generate 构建 thinking_instruction */
const THINKING_INSTRUCTION = `Review the director notes and stage goal. Check world consistency. Plan the next narrative beat based on the player's action. Maintain tone and pacing continuity.`

function StoryTab() {
  const n = useNarrative()
  const [history, setHistory] = useState<StoryHistory>({ turn_ids: [], story: {} })
  const [input, setInput] = useState('')
  const [turnCounter, setTurnCounter] = useState(0)
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [log, setLog] = useState<string[]>([])
  const historyEndRef = useRef<HTMLDivElement>(null)
  const busy = n.phase !== 'idle'

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }, [])

  // Load history on mount
  useEffect(() => {
    n.getHistory().then(h => {
      setHistory(h)
      setTurnCounter(h.turn_ids.length)
      addLog(`加载剧情历史: ${h.turn_ids.length} 回合`)
    }).catch(() => addLog('加载剧情历史失败'))
  }, [])

  // Auto-scroll history
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.turn_ids.length])

  // Build previous_content_overview from recent history (or start_story)
  const buildOverview = useCallback((): string => {
    if (history.turn_ids.length === 0) {
      return n.startStory ?? '(无前情)'
    }
    // Take last 2 turns
    const recentIds = history.turn_ids.slice(-2)
    return recentIds.map(id => {
      const turn = history.story[id]
      const content = turn?.content as Record<string, unknown> | undefined
      const playerAction = (content?.player_action as string) ?? ''
      const novelContent = (content?.novel_content as string) ?? ''
      return `[玩家行动] ${playerAction}\n[剧情] ${novelContent}`
    }).join('\n---\n')
  }, [history, n.startStory])

  // Full turn loop
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || busy) return
    const playerAction = input.trim()
    setInput('')
    setUpdateResult(null)

    try {
      // Phase 1: Generate
      addLog(`开始生成 — 玩家行动: "${playerAction}"`)
      const result = await n.generate({
        create_request: `玩家行动: ${playerAction}\n\n请根据玩家行动续写故事。`,
        thinking_instruction: THINKING_INSTRUCTION,
        previous_content_overview: buildOverview(),
        output_content_schema: CONTENT_SCHEMA,
      })
      addLog(`生成完成`)

      // Phase 2: Update game state
      addLog(`更新游戏状态...`)
      const novelContent = (result.content as Record<string, unknown>)?.novel_content ?? ''
      const update = await n.updateState({
        new_event: `[玩家行动] ${playerAction}\n[剧情] ${novelContent}`,
      })
      setUpdateResult(update)
      addLog(`状态更新: ${update.success ? '成功' : '失败'} — ${update.outline ?? ''}`)

      // Phase 3: Save
      addLog(`保存存档...`)
      const turnId = `turn-${turnCounter + 1}`
      const checkpointId = await n.save(
        `回合 ${turnCounter + 1}`,
        `玩家行动: ${playerAction}`,
      )
      addLog(`存档完成: ${checkpointId}`)

      // Phase 4: Record history
      await n.addHistory(turnId, {
        content: {
          player_action: playerAction,
          novel_content: novelContent,
          update_summary: update.summary ?? update.outline ?? '',
        },
        checkpoint_id: checkpointId,
      })
      addLog(`历史记录完成: ${turnId}`)

      // Refresh history & clear generation state
      const newHistory = await n.getHistory()
      setHistory(newHistory)
      setTurnCounter(newHistory.turn_ids.length)
      setUpdateResult(null)
      n.reset()
    } catch (err) {
      addLog(`错误: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [input, busy, n, buildOverview, turnCounter, addLog])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit() }
  }, [handleSubmit])

  const phaseLabel: Record<string, string> = {
    idle: '',
    collecting: 'RAG 文档检索中...',
    reasoning: 'AI 思考中...',
    generating: '故事生成中...',
    updating: '更新游戏状态...',
    saving: '保存存档...',
  }

  return (
    <div className="story-panel">
      {/* ── 剧情历史区 ── */}
      <div className="story-history">
        <h3 className="story-section-title">剧情历史</h3>
        {n.backgroundStory && (
          <div className="story-turn story-background">
            <div className="story-turn-label">背景故事</div>
            <div className="story-turn-content">{n.backgroundStory}</div>
          </div>
        )}
        {n.startStory && history.turn_ids.length === 0 && (
          <div className="story-turn story-start">
            <div className="story-turn-label">开场故事</div>
            <div className="story-turn-content">{n.startStory}</div>
          </div>
        )}
        {history.turn_ids.map((id, i) => {
          const turn = history.story[id]
          const content = turn?.content as Record<string, unknown> | undefined
          return (
            <div key={id} className="story-turn">
              <div className="story-turn-label">回合 {i + 1}</div>
              {content?.player_action && (
                <div className="story-player-action">▶ {content.player_action as string}</div>
              )}
              <div className="story-turn-content">{(content?.novel_content as string) ?? ''}</div>
              {content?.update_summary && (
                <div className="story-update-summary">{content.update_summary as string}</div>
              )}
            </div>
          )
        })}
        {history.turn_ids.length === 0 && !n.startStory && (
          <p className="empty-state">暂无剧情历史 — 输入行动开始冒险</p>
        )}
        <div ref={historyEndRef} />
      </div>

      {/* ── 新生成内容区 ── */}
      {busy && (
        <div className="story-generation">
          <h3 className="story-section-title">
            当前生成 <span className="story-phase">{phaseLabel[n.phase]}</span>
          </h3>
          {n.stream.collectorOutline && (
            <details className="story-debug">
              <summary>RAG 概要</summary>
              <pre>{n.stream.collectorOutline}</pre>
            </details>
          )}
          {n.stream.reasoning && (
            <details className="story-debug">
              <summary>AI 推理</summary>
              <pre>{n.stream.reasoning}</pre>
            </details>
          )}
          <StreamText
            content={n.stream.partialContent}
            field="novel_content"
            speed={20}
            className="story-stream-text"
          />
        </div>
      )}

      {/* 状态更新结果 */}
      {updateResult && (
        <div className={`story-update ${updateResult.success ? 'success' : 'error'}`}>
          <strong>状态更新{updateResult.success ? '成功' : '失败'}</strong>
          {updateResult.summary && <p>{updateResult.summary}</p>}
          {updateResult.outline && <p className="story-update-outline">{updateResult.outline}</p>}
          {updateResult.error && <p className="story-update-error">{updateResult.error}</p>}
        </div>
      )}

      {/* 错误提示 */}
      {n.error && <div className="story-error">{n.error}</div>}

      {/* ── 玩家行动区 ── */}
      <div className="story-input">
        <textarea
          className="story-input-field"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={busy ? '生成中，请稍候...' : '输入你的行动...（Ctrl+Enter 提交）'}
          disabled={busy}
          rows={3}
        />
        <button className="story-submit-btn" onClick={handleSubmit} disabled={busy || !input.trim()}>
          {busy ? phaseLabel[n.phase] || '处理中...' : '▶ 行动'}
        </button>
      </div>

      {/* ── 调试日志 ── */}
      {log.length > 0 && (
        <details className="story-log">
          <summary>调试日志 ({log.length})</summary>
          <pre>{log.join('\n')}</pre>
        </details>
      )}
    </div>
  )
}

// ── Player Tab — 使用 compound 组件精细控制 ──

function PlayerTab() {
  return (
    <Player.Root fallback={<p className="empty-state">暂无玩家数据</p>} className="entity-card player-card">
      <div className="card-header">
        <Player.Identity />
        <Player.Emotion />
      </div>
      <Player.Titles />
      <Player.Personality />
      <Player.Description />
      <Player.Appearance />
      <SectionHeading label="��性" />
      <Player.Stats />
      <SectionHeading label="位置" />
      <Player.Location />
      <Player.Organization />
      <SectionHeading label="物品" />
      <Player.Inventory />
      <SectionHeading label="状态效果" />
      <Player.StatusEffects />
      <SectionHeading label="自定义组件" />
      <Player.CustomComponents />
      <SectionHeading label="已知信息" />
      <Player.KnownInfos />
      <SectionHeading label="交互" />
      <Player.Interactions />
    </Player.Root>
  )
}

// ── Creatures Tab — 展开/折叠每个 NPC ──

function CreaturesTab() {
  const { player, creatures } = useGameData()
  const npcIds: string[] = []
  for (const [id, e] of creatures) {
    if (!e.IsPlayer) npcIds.push(id)
  }

  return (
    <div className="entity-grid">
      {player?.Creature && (
        <CreatureCard id={player.Creature.creature_id} highlight="player" />
      )}
      {npcIds.map((id) => <CreatureCard key={id} id={id} />)}
      {!player && npcIds.length === 0 && <p className="empty-state">暂无角色���据</p>}
    </div>
  )
}

function CreatureCard({ id, highlight }: { id: string; highlight?: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Creature.Root id={id} as="article" className={`entity-card creature-card ${highlight ? `highlight-${highlight}` : ''}`}>
      <div className="card-header" onClick={() => setExpanded(!expanded)}>
        <Creature.Identity />
        <Creature.Emotion />
        <span className="expand-toggle">{expanded ? '▾' : '▸'}</span>
      </div>
      <Creature.Titles />
      {expanded && (
        <>
          <Creature.Personality />
          <Creature.Description />
          <Creature.Appearance />
          <SectionHeading label="属性" />
          <Creature.Stats />
          <Creature.Goal />
          <SectionHeading label="位置" />
          <Creature.Location />
          <Creature.Organization />
          <SectionHeading label="��品" />
          <Creature.Inventory />
          <SectionHeading label="状态效果" />
          <Creature.StatusEffects />
          <SectionHeading label="自定义组件" />
          <Creature.CustomComponents />
          <Creature.KnownInfos />
          <Creature.Interactions />
        </>
      )}
    </Creature.Root>
  )
}

// ── Regions Tab ──

function RegionsTab() {
  const { regions } = useGameData()
  const ids = Array.from(regions.keys())
  if (ids.length === 0) return <p className="empty-state">暂无区域数据</p>

  return (
    <div className="entity-grid">
      {ids.map((id) => <RegionCard key={id} id={id} />)}
    </div>
  )
}

function RegionCard({ id }: { id: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Region.Root id={id} as="article" className="entity-card region-card">
      <div className="card-header" onClick={() => setExpanded(!expanded)}>
        <Region.Name />
        <span className="expand-toggle">{expanded ? '▾' : '▸'}</span>
      </div>
      <Region.Description />
      {expanded && (
        <>
          <Region.Metadata />
          <SectionHeading label="地点" />
          <Region.Locations />
          <SectionHeading label="路径" />
          <Region.Paths />
          <Region.StatusEffects />
          <Region.Interactions />
        </>
      )}
    </Region.Root>
  )
}

// ── Organizations Tab ──

function OrganizationsTab() {
  const { organizations } = useGameData()
  const ids = Array.from(organizations.keys())
  if (ids.length === 0) return <p className="empty-state">���无组织数据</p>

  return (
    <div className="entity-grid">
      {ids.map((id) => (
        <Org.Root key={id} id={id} as="article" className="entity-card org-card">
          <div className="card-header"><Org.Name /></div>
          <Org.Description />
          <SectionHeading label="领地" />
          <Org.Territories />
          <SectionHeading label="成员" />
          <Org.Members />
          <Org.StatusEffects />
          <Org.Interactions />
        </Org.Root>
      ))}
    </div>
  )
}

// ── World Tab ──

function WorldTab() {
  const { world } = useGameData()
  if (!world) return <p className="empty-state">暂无世界数据</p>

  return (
    <div className="world-panel">
      {world.GameTime && (
        <div className="world-section">
          <SectionHeading label="游戏时间" />
          <p className="game-time">
            {world.GameTime.year}年 {world.GameTime.month}月 {world.GameTime.day}日{' '}
            {String(world.GameTime.hour).padStart(2, '0')}:{String(world.GameTime.minute).padStart(2, '0')}
          </p>
        </div>
      )}

      {world.Registry?.creature_attr_fields && world.Registry.creature_attr_fields.length > 0 && (
        <div className="world-section">
          <SectionHeading label="属性注册表" />
          <dl className="registry-fields">
            {world.Registry.creature_attr_fields.map((f) => (
              <div key={f.field_name} className="registry-field">
                <dt>{f.field_display_name ?? f.field_name}</dt>
                <dd>{f.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {world.Events?.events && world.Events.events.length > 0 && (
        <div className="world-section">
          <SectionHeading label="事件" />
          <ul className="event-list">
            {world.Events.events.map((ev) => (
              <li key={ev.event_id} className="event-item">
                <span className="event-title">{ev.title}</span>
                <span className="event-summary">{ev.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {world.DirectorNotes?.stage_goal && (
        <div className="world-section">
          <SectionHeading label="导演笔记" />
          <p className="director-goal">{world.DirectorNotes.stage_goal}</p>
        </div>
      )}

      {world.CustomComponentRegistry?.custom_components && world.CustomComponentRegistry.custom_components.length > 0 && (
        <div className="world-section">
          <SectionHeading label="自定义组件注册表" />
          <ul className="comp-registry">
            {world.CustomComponentRegistry.custom_components.map((c) => (
              <li key={c.component_key}>
                <strong>{c.component_name}</strong>
                <code>{c.component_key}</code>
                {c.is_array && <span className="array-badge">数组</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Data Tab — 原始数据查看 ──

function DataTab() {
  const n = useNarrative()
  const [history, setHistory] = useState<StoryHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    n.getHistory()
      .then(h => { setHistory(h); setLoading(false) })
      .catch(err => { setError(String(err)); setLoading(false) })
  }, [])

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    n.getHistory()
      .then(h => { setHistory(h); setLoading(false) })
      .catch(err => { setError(String(err)); setLoading(false) })
  }, [n])

  return (
    <div className="data-panel">
      <div className="data-section">
        <div className="data-section-header">
          <h3 className="story-section-title">背景故事</h3>
        </div>
        <pre className="data-json">{n.backgroundStory ?? '(无)'}</pre>
      </div>

      <div className="data-section">
        <div className="data-section-header">
          <h3 className="story-section-title">开场故事</h3>
        </div>
        <pre className="data-json">{n.startStory ?? '(无)'}</pre>
      </div>

      <div className="data-section">
        <div className="data-section-header">
          <h3 className="story-section-title">剧情历史</h3>
          <button className="data-reload-btn" onClick={reload} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
        {error && <pre className="console-error">{error}</pre>}
        {history && history.turn_ids.length === 0 && <p className="empty-state">暂无剧情历史</p>}
        {history && history.turn_ids.map(id => (
          <div key={id} className="data-entry">
            <div className="data-entry-id">{id}</div>
            <pre className="data-json">{JSON.stringify(history.story[id], null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Console Tab ──

interface ConsoleEntry {
  id: number
  code: string
  success: boolean
  result?: unknown
  output?: string
  error?: string
  timestamp: number
}

function ConsoleTab() {
  const pub = usePub()
  const [code, setCode] = useState('-- 在这里输入 Lua 代码\nprint("Hello from Lua!")\nreturn 1 + 1')
  const [history, setHistory] = useState<ConsoleEntry[]>([])
  const [running, setRunning] = useState(false)
  const nextId = useRef(0)

  const execute = useCallback(async () => {
    if (!code.trim() || running) return
    setRunning(true)
    const startTime = Date.now()
    try {
      const res = await (pub as any).test.ExecuteLuaCode({ code })
      setHistory((prev) => [{ id: nextId.current++, code, success: res.success ?? false, result: res.result, output: res.output, error: res.error, timestamp: Date.now() - startTime }, ...prev])
    } catch (err) {
      setHistory((prev) => [{ id: nextId.current++, code, success: false, error: String(err), timestamp: Date.now() - startTime }, ...prev])
    }
    setRunning(false)
  }, [code, running, pub])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); execute() }
  }, [execute])

  return (
    <div className="console-panel">
      <div className="console-editor">
        <textarea className="console-input" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={handleKeyDown} spellCheck={false} rows={6} />
        <div className="console-toolbar">
          <span className="console-hint">Ctrl+Enter 执行</span>
          <button className="console-run-btn" onClick={execute} disabled={running || !code.trim()}>
            {running ? '执行中…' : '▶ 执行'}
          </button>
        </div>
      </div>
      <div className="console-history">
        {history.length === 0 && <p className="empty-state">输入 Lua 代码并执行，结果会显示在这里</p>}
        {history.map((entry) => (
          <div key={entry.id} className={`console-entry ${entry.success ? 'success' : 'error'}`}>
            <div className="console-entry-header">
              <span className={`console-status ${entry.success ? 'ok' : 'err'}`}>{entry.success ? '✓' : '✗'}</span>
              <code className="console-entry-code">{entry.code.length > 80 ? entry.code.slice(0, 80) + '…' : entry.code}</code>
              <span className="console-entry-time">{entry.timestamp}ms</span>
            </div>
            {entry.output && <pre className="console-output">{entry.output}</pre>}
            {entry.success && entry.result !== undefined && entry.result !== null && (
              <pre className="console-result">→ {typeof entry.result === 'object' ? JSON.stringify(entry.result, null, 2) : String(entry.result)}</pre>
            )}
            {entry.error && <pre className="console-error">{entry.error}</pre>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared ──

function SectionHeading({ label }: { label: string }) {
  return <h4 className="section-heading">{label}</h4>
}

// ── App ──

export default function App() {
  const [tab, setTab] = useState<Tab>('story')

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Game Playground</h1>
        <p className="app-subtitle">组件预览 · 实时数据</p>
      </header>
      <TabBar active={tab} onChange={setTab} />
      <main className={`app-content ${tab === 'console' || tab === 'story' || tab === 'data' ? 'app-content-wide' : ''}`}>
        {tab === 'story' && <StoryTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'player' && <PlayerTab />}
        {tab === 'creatures' && <CreaturesTab />}
        {tab === 'regions' && <RegionsTab />}
        {tab === 'organizations' && <OrganizationsTab />}
        {tab === 'world' && <WorldTab />}
        {tab === 'console' && <ConsoleTab />}
      </main>
    </div>
  )
}
