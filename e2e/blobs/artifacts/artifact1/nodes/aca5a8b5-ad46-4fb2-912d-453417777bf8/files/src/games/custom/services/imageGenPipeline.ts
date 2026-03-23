/**
 * Image Generation Pipeline — 批量生成角色立绘 + 表情头像
 *
 * 管线流程：
 *   阶段1: 并发为所有角色生成立绘 (文生图)
 *   阶段2: 每个角色的立绘完成后，并发生成 9 张表情头像 (图生图)
 *
 * 每个角色共 10 次 API 调用 (1 立绘 + 9 表情)
 */

import type { Creature } from '../../../api/types'
import type { GalExpression } from '../types'
import { generateStanding, generateAvatar, enhancePrompt, isPromptEnhancerConfigured } from './imageApi'

// ============================================================================
// Types
// ============================================================================

export type PipelinePhase = 'idle' | 'generating-standings' | 'generating-avatars' | 'done' | 'error'

export interface CreatureProgress {
  creatureId: string
  name: string
  standingDone: boolean
  standingError?: string
  avatarsDone: number
  avatarsTotal: number
  avatarErrors: string[]
}

export interface PipelineState {
  phase: PipelinePhase
  creatures: CreatureProgress[]
  error?: string
}

export type PipelineCallback = (state: PipelineState) => void

// ============================================================================
// Expression prompts
// ============================================================================

const EXPRESSION_PREFIX = '基于参考图中的角色，生成一张头像。碧蓝幻想（Granblue Fantasy）赛璐璐风格，清晰线条，柔和色彩渐变，眼睛高光精致。只需要头部和脖子，不露出衣服。保持角色的发色、发型、眼睛颜色和瞳孔样式完全不变。背景必须为纯白色（#FFFFFF），无任何装饰。'

const EXPRESSION_PROMPTS: Record<GalExpression, string> = {
  normal: '平静自然的表情，嘴唇微闭，眼神柔和放松，正面直视，没有明显情绪波动。',
  happy: '开心的笑容，嘴角上扬，眉眼弯起呈弧形，眼睛微眯，露出愉悦的高光。',
  angry: '愤怒的表情，眉头紧皱向下压，嘴唇紧抿咬牙，眼神锐利充满不满，头顶可加漫画式怒气符号。',
  sad: '悲伤的表情，眉头上挑呈八字，眼神低垂黯淡，嘴角下撇，眼眶微红，快要哭出来的感觉。',
  surprised: '惊讶的表情，双眼圆睁，瞳孔缩小，眉毛高高挑起，嘴巴张开呈O型。',
  shy: '害羞的表情，双颊明显泛红，眼神向旁边躲避不敢直视，嘴角带着一丝不好意思的微笑。',
  confused: '困惑的表情，一边眉毛挑起一边压低，嘴角微歪，眼神迷茫，头顶可加漫画式问号符号。',
  thinking: '思考的表情，双眼轻闭或半闭，嘴唇微抿，眉头略皱，表情沉静专注。',
  smirk: '坏笑的表情，嘴角一侧上扬形成不对称的笑，眼神半眯带有狡黠，略带挑衅和自信。',
}

// ============================================================================
// Standing prompt builder
// ============================================================================

async function buildStandingPrompt(creature: Creature): Promise<string> {
  const descParts: string[] = []
  if (creature.gender) descParts.push(`性别：${creature.gender}`)
  if (creature.race) descParts.push(`种族：${creature.race}`)
  if (creature.appearance?.body) descParts.push(`外貌特征：${creature.appearance.body}`)
  if (creature.appearance?.clothing) descParts.push(`服装：${creature.appearance.clothing}`)

  let characterDesc = descParts.join('。')

  if (characterDesc && isPromptEnhancerConfigured()) {
    characterDesc = await enhancePrompt(characterDesc)
  }

  return [
    '日式游戏角色全身立绘，赛璐璐风格，清晰锐利的线条，柔和色彩渐变，高质量细节。',
    '单个角色，正面全身站姿，从头顶到脚底完整呈现，双脚着地。',
    characterDesc,
    '角色面朝正前方，自然放松的站姿，双手自然下垂或轻放身侧，表情平静温和。',
    '纯白色背景（#FFFFFF），无任何背景元素、装饰、阴影或花纹。',
    '人体比例正常协调，不夸张不变形。',
  ].filter(Boolean).join(' ')
}

// ============================================================================
// Helpers
// ============================================================================

/** 从 API 响应中提取 dataUrl */
function extractDataUrl(item: { url?: string; b64_json?: string }): string | null {
  if (item.b64_json) {
    return item.b64_json.startsWith('data:')
      ? item.b64_json
      : `data:image/png;base64,${item.b64_json}`
  }
  // URL 的情况：NanoGPT 返回的 URL 可以直接用
  if (item.url) return item.url
  return null
}

// ============================================================================
// Pipeline
// ============================================================================

export interface PipelineInput {
  creatures: Array<{
    creature: Creature
    needStanding: boolean
    needAvatars: GalExpression[]
  }>
  onSpriteReady: (creatureId: string, imageType: 'standing' | 'avatar', expression: GalExpression, dataUrl: string, mimeType: string) => void
  onProgress: PipelineCallback
}

export async function runImageGenPipeline(input: PipelineInput): Promise<void> {
  const { creatures, onSpriteReady, onProgress } = input

  const state: PipelineState = {
    phase: 'generating-standings',
    creatures: creatures.map(c => ({
      creatureId: c.creature.creature_id,
      name: c.creature.name,
      standingDone: !c.needStanding,
      avatarsDone: 0,
      avatarsTotal: c.needAvatars.length,
      avatarErrors: [],
    })),
  }

  onProgress({ ...state })

  // ── 阶段1: 并发生成所有立绘（文生图） ──

  const standingDataUrls = new Map<string, string>()

  await Promise.all(
    creatures.map(async (c, idx) => {
      if (!c.needStanding) return

      try {
        const prompt = await buildStandingPrompt(c.creature)
        const result = await generateStanding({ prompt })

        const item = result.data?.[0]
        if (!item) throw new Error('No image data in response')

        const dataUrl = extractDataUrl(item)
        if (!dataUrl) throw new Error('No image URL or base64 in response')

        standingDataUrls.set(c.creature.creature_id, dataUrl)
        onSpriteReady(c.creature.creature_id, 'standing', 'normal', dataUrl, 'image/png')

        state.creatures[idx].standingDone = true
      } catch (e) {
        state.creatures[idx].standingDone = true
        state.creatures[idx].standingError = (e as Error).message
      }

      onProgress({ ...state })
    })
  )

  // ── 阶段2: 对每个角色并发生成表情头像 ──

  state.phase = 'generating-avatars'
  onProgress({ ...state })

  await Promise.all(
    creatures.map(async (c, idx) => {
      if (c.needAvatars.length === 0) return

      const standingUrl = standingDataUrls.get(c.creature.creature_id)

      if (!standingUrl) {
        state.creatures[idx].avatarErrors.push('No standing sprite available for avatar generation')
        state.creatures[idx].avatarsDone = c.needAvatars.length
        onProgress({ ...state })
        return
      }

      // 并发 9 张表情
      await Promise.all(
        c.needAvatars.map(async (expr) => {
          try {
            const prompt = `${EXPRESSION_PREFIX}\n\n${EXPRESSION_PROMPTS[expr]}`
            const result = await generateAvatar({
              image: standingUrl,
              prompt,
            })

            const item = result.data?.[0]
            if (!item) throw new Error('No image data in response')

            const dataUrl = extractDataUrl(item)
            if (!dataUrl) throw new Error('No image URL or base64 in response')

            onSpriteReady(c.creature.creature_id, 'avatar', expr, dataUrl, 'image/png')
          } catch (e) {
            state.creatures[idx].avatarErrors.push(`${expr}: ${(e as Error).message}`)
          }

          state.creatures[idx].avatarsDone++
          onProgress({ ...state })
        })
      )
    })
  )

  state.phase = 'done'
  onProgress({ ...state })
}
