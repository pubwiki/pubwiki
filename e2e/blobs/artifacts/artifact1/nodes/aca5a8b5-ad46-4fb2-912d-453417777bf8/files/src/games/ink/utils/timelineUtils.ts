import type { GameSaveInfo } from '../../../api/types'
import type { TimelineNode, TimelineTreeNode } from '../types'
import type { GameTime } from '../types'

const TIMELINE_PREFIX = 'timeline::'

/** 将父链编码为存档 description 字符串 */
export function encodeTimelineDesc(parentChain: TimelineNode[]): string {
  return TIMELINE_PREFIX + JSON.stringify(parentChain)
}

/** 解码存档 description，返回父链；非 timeline 格式返回 null */
export function parseTimelineDesc(description: string): TimelineNode[] | null {
  if (!description.startsWith(TIMELINE_PREFIX)) return null
  try {
    const arr = JSON.parse(description.slice(TIMELINE_PREFIX.length))
    if (!Array.isArray(arr)) return null
    return arr as TimelineNode[]
  } catch {
    return null
  }
}

/** 将 GameTime 格式化为紧凑字符串，用于存入 TimelineNode.gt */
export function formatGameTimeStr(gt: GameTime | null): string | undefined {
  if (!gt) return undefined
  return `${gt.year}/${gt.month}/${gt.day} ${gt.hour}:${gt.minute.toString().padStart(2, '0')}`
}

/** 从存档标题中提取章节名（去掉 [turn-N] 前缀） */
export function cleanSaveTitle(title: string): string {
  return title.replace(/^\[turn-\d+\]\s*/, '')
}

/** 从扁平存档列表重建分支时间线树 */
export function buildTimelineTree(
  saves: GameSaveInfo[],
  currentChain: TimelineNode[]
): TimelineTreeNode {
  const root: TimelineTreeNode = {
    checkpointId: '__root__',
    title: '',
    children: [],
  }

  // 当前分支节点 ID 集合，用于高亮
  const currentIds = new Set(currentChain.map(n => n.id))

  const nodeMap = new Map<string, TimelineTreeNode>()
  nodeMap.set('__root__', root)

  // 过滤出有效的 timeline 存档
  const timelineSaves = saves.filter(s =>
    !s.title.startsWith('[pre-gen]') && s.description.startsWith(TIMELINE_PREFIX)
  )

  for (const save of timelineSaves) {
    const parentChain = parseTimelineDesc(save.description)
    if (!parentChain) continue

    // 完整链 = 父链 + 自身
    const fullChain: TimelineNode[] = [
      ...parentChain,
      { id: save.checkpointId, t: cleanSaveTitle(save.title) }
    ]

    let parentId = '__root__'
    for (const node of fullChain) {
      if (!nodeMap.has(node.id)) {
        const treeNode: TimelineTreeNode = {
          checkpointId: node.id,
          title: node.t,
          gameTime: node.gt,
          children: [],
          isCurrent: currentIds.has(node.id),
        }
        nodeMap.set(node.id, treeNode)

        // 挂载到父节点
        const parent = nodeMap.get(parentId)!
        if (!parent.children.some(c => c.checkpointId === node.id)) {
          parent.children.push(treeNode)
        }
      } else {
        // 节点已存在，更新 isCurrent 标记和时间戳
        const existing = nodeMap.get(node.id)!
        if (currentIds.has(node.id)) existing.isCurrent = true
      }
      parentId = node.id
    }

    // 更新叶子节点的时间戳（使用存档自身的时间戳）
    const leafNode = nodeMap.get(save.checkpointId)
    if (leafNode) {
      leafNode.timestamp = save.timestamp
    }
  }

  // 为中间节点补充时间戳（取最早的子节点时间戳）
  propagateTimestamps(root)

  return root
}

/** 递归向上传播时间戳（取子树中最小的时间戳） */
function propagateTimestamps(node: TimelineTreeNode): number | undefined {
  if (node.children.length === 0) return node.timestamp

  let earliest: number | undefined
  for (const child of node.children) {
    const t = propagateTimestamps(child)
    if (t !== undefined && (earliest === undefined || t < earliest)) {
      earliest = t
    }
  }

  if (node.timestamp === undefined && earliest !== undefined) {
    node.timestamp = earliest
  }
  return node.timestamp ?? earliest
}
