/**
 * TimelinePanel - 横向卷轴分支时间线
 *
 * 底部滑出面板，利用 Y 轴展示分支层次。
 * 每条分支线是一行可横向滚动的节点。
 * 仅当前路径默认展开，其余分支折叠。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { listSaves } from '../../utils'
import { useGameStore } from '../stores/gameStore'
import { buildTimelineTree } from '../utils/timelineUtils'
import type { TimelineTreeNode } from '../types'
import { showConfirm } from '../../../components/AlertDialog'
import './TimelinePanel.css'

/* ============================================================
   数据结构：将树拆分为「线性段 + 子分支」
   ============================================================ */

interface BranchSegment {
  nodes: TimelineTreeNode[]   // 线性节点序列（直到叶子或分支点）
  subBranches: BranchSegment[] // 分支点处的子分支
  containsCurrent: boolean     // 是否包含当前节点
}

/** 从一个起始节点提取线性段，遇到分支点则拆分 */
function extractSegment(startNode: TimelineTreeNode): BranchSegment {
  const nodes: TimelineTreeNode[] = []
  let cur = startNode

  // 沿着单链向下走，遇到分支或叶子停止
  while (true) {
    nodes.push(cur)
    if (cur.children.length === 1) {
      cur = cur.children[0]
    } else {
      break
    }
  }

  // 最后一个节点的子节点是分支
  const subBranches = cur.children.map(child => extractSegment(child))
  const containsCurrent = nodes.some(n => n.isCurrent) ||
    subBranches.some(b => b.containsCurrent)

  return { nodes, subBranches, containsCurrent }
}

/** 从根节点提取所有顶层分支段 */
function extractTopSegments(root: TimelineTreeNode): BranchSegment[] {
  if (root.children.length === 0) return []
  if (root.children.length === 1) return [extractSegment(root.children[0])]
  return root.children.map(child => extractSegment(child))
}

/** 递归统计一个段落下所有节点数 */
function countNodes(seg: BranchSegment): number {
  return seg.nodes.length + seg.subBranches.reduce((sum, b) => sum + countNodes(b), 0)
}

/* ============================================================
   面板主组件
   ============================================================ */

interface TimelinePanelProps {
  open: boolean
  onClose: () => void
  onLoadCheckpoint: (checkpointId: string) => Promise<void>
}

export function TimelinePanel({ open, onClose, onLoadCheckpoint }: TimelinePanelProps) {
  const { t } = useTranslation('game')
  const [tree, setTree] = useState<TimelineTreeNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingCheckpoint, setLoadingCheckpoint] = useState<string | null>(null)
  const timelineChain = useGameStore(s => s.timelineChain)

  const loadTree = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listSaves()
      const built = buildTimelineTree(result.saves, timelineChain)
      setTree(built)
    } catch (e) {
      console.error('Failed to load timeline:', e)
    } finally {
      setLoading(false)
    }
  }, [timelineChain])

  useEffect(() => {
    if (open) loadTree()
  }, [open, loadTree])

  const handleNodeClick = useCallback(async (checkpointId: string) => {
    if (timelineChain[timelineChain.length - 1]?.id === checkpointId) return
    if (!await showConfirm(t('ink.timeline.loadConfirm'))) return
    setLoadingCheckpoint(checkpointId)
    try {
      await onLoadCheckpoint(checkpointId)
    } finally {
      setLoadingCheckpoint(null)
    }
  }, [onLoadCheckpoint, timelineChain, t])

  if (!open) return null

  const segments = tree ? extractTopSegments(tree) : []
  const currentId = timelineChain[timelineChain.length - 1]?.id

  return createPortal(
    <div className="tl-backdrop" onClick={onClose}>
      <div className="tl-panel" onClick={e => e.stopPropagation()}>
        <div className="tl-header">
          <span className="tl-title">{t('ink.timeline.title')}</span>
          <button className="tl-close" onClick={onClose}>✕</button>
        </div>

        <div className="tl-body">
          {loading ? (
            <div className="tl-empty">{t('ink.timeline.loading')}</div>
          ) : segments.length === 0 ? (
            <div className="tl-empty">{t('ink.timeline.empty')}</div>
          ) : (
            <div className="tl-branches">
              {segments.map((seg, i) => (
                <BranchRow
                  key={seg.nodes[0]?.checkpointId ?? i}
                  segment={seg}
                  depth={0}
                  currentId={currentId}
                  loadingCheckpoint={loadingCheckpoint}
                  onNodeClick={handleNodeClick}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ============================================================
   分支行组件（递归）
   ============================================================ */

interface BranchRowProps {
  segment: BranchSegment
  depth: number
  currentId?: string
  loadingCheckpoint: string | null
  onNodeClick: (id: string) => void
  t: (key: string) => string
}

function BranchRow({ segment, depth, currentId, loadingCheckpoint, onNodeClick, t }: BranchRowProps) {
  const [expanded, setExpanded] = useState(segment.containsCurrent)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentNodeRef = useRef<HTMLDivElement>(null)
  const hasSubs = segment.subBranches.length > 0
  const firstTitle = segment.nodes[0]?.title || '...'

  // 展开后自动滚到当前节点
  useEffect(() => {
    if (expanded && currentNodeRef.current) {
      const timer = setTimeout(() => {
        currentNodeRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [expanded])

  // 鼠标滚轮转横向滚动
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!scrollRef.current) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      scrollRef.current.scrollLeft += e.deltaY
    }
  }, [])

  // 折叠态：紧凑摘要行
  if (!expanded) {
    const total = countNodes(segment)
    return (
      <div className="tl-branch-collapsed" style={{ marginLeft: depth > 0 ? 20 : 0 }}>
        <button className="tl-expand-btn" onClick={() => setExpanded(true)}>
          <span className="tl-expand-arrow">▸</span>
          <span className="tl-expand-title">{firstTitle}</span>
          <span className="tl-expand-count">
            {total > 1 ? `${total} ${t('ink.timeline.nodes')}` : ''}
          </span>
        </button>
      </div>
    )
  }

  // 展开态：水平节点行 + 递归子分支
  return (
    <div className={`tl-branch ${segment.containsCurrent ? 'tl-branch--current' : ''}`}
      style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      {/* 折叠按钮（非顶层当前路径才显示） */}
      {(depth > 0 || !segment.containsCurrent) && (
        <button className="tl-collapse-btn" onClick={() => setExpanded(false)}>
          <span className="tl-expand-arrow">▾</span>
          <span className="tl-collapse-label">{firstTitle}</span>
        </button>
      )}

      {/* 水平滚动节点行 */}
      <div className="tl-row-scroll" ref={scrollRef} onWheel={handleWheel}>
        <div className="tl-row">
          <div className="tl-axis" />
          {segment.nodes.map((node, i) => {
            const isCurrent = node.checkpointId === currentId
            const isOnPath = !!node.isCurrent
            const isLoading = node.checkpointId === loadingCheckpoint
            // 优先显示游戏世界时间，旧存档无 gameTime 则显示 "unknown"
            const timeStr = node.gameTime || t('ink.timeline.unknownTime')

            return (
              <div
                key={node.checkpointId}
                ref={isCurrent ? currentNodeRef : undefined}
                className={[
                  'tl-node',
                  isCurrent ? 'tl-node--current' : '',
                  isOnPath ? 'tl-node--on-path' : '',
                  isLoading ? 'tl-node--loading' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => !isCurrent && !isLoading && onNodeClick(node.checkpointId)}
              >
                <div className="tl-dot" />
                <div className="tl-card">
                  <span className="tl-card-title">{node.title || `#${i + 1}`}</span>
                  {timeStr && <span className="tl-card-time">{timeStr}</span>}
                  {isCurrent && <span className="tl-card-badge">{t('ink.timeline.current')}</span>}
                </div>
              </div>
            )
          })}
          {/* 分支点标记 */}
          {hasSubs && (
            <div className="tl-branch-point">
              <div className="tl-dot tl-dot--branch" />
              <span className="tl-branch-point-label">
                {segment.subBranches.length} {t('ink.timeline.branches')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 子分支（递归） */}
      {hasSubs && (
        <div className="tl-sub-branches">
          {segment.subBranches.map((sub, i) => (
            <BranchRow
              key={sub.nodes[0]?.checkpointId ?? i}
              segment={sub}
              depth={depth + 1}
              currentId={currentId}
              loadingCheckpoint={loadingCheckpoint}
              onNodeClick={onNodeClick}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}
