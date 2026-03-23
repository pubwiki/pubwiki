/**
 * Image API Service — 图片生成 API 封装
 *
 * 使用 NanoGPT API，三类图片模型 + prompt 增强 LLM：
 * - standing: 立绘生成（文生图）
 * - avatar:   表情头像生成（图生图）
 * - cg:       CG 生成（预留）
 * - promptEnhancer: LLM prompt 改写
 *
 * 配置存储在 localStorage，key: 'image-api-config'
 */

// ============================================================================
// Types
// ============================================================================

export interface ImageModelConfig {
  endpoint: string
  apiKey: string
  model: string
  extraParams?: string  // 用户自定义 JSON 参数，如 {"lora_url_1": "https://..."}
}

export interface ImageAPIConfig {
  standing: ImageModelConfig
  avatar: ImageModelConfig
  cg: ImageModelConfig
  promptEnhancer: ImageModelConfig
}

export interface ImageGenerationInput {
  prompt: string
  resolution?: string
  imageDataUrl?: string  // 有值时为图生图
}

export interface ImageAPIResponse {
  data: Array<{ url?: string; b64_json?: string }>
}

// ============================================================================
// Storage
// ============================================================================

const STORAGE_KEY = 'image-api-config'

const DEFAULT_ENDPOINT = 'https://nano-gpt.com/api/v1/images/generations'

const DEFAULT_CONFIG: ImageAPIConfig = {
  standing: { endpoint: DEFAULT_ENDPOINT, apiKey: '', model: 'flux-2-max' },
  avatar: { endpoint: DEFAULT_ENDPOINT, apiKey: '', model: 'flux-2-max' },
  cg: { endpoint: DEFAULT_ENDPOINT, apiKey: '', model: 'flux-2-max' },
  promptEnhancer: { endpoint: '', apiKey: '', model: '' },
}

export function loadImageAPIConfig(): ImageAPIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw)
    // 兼容旧版 nanogpt 单配置
    if (parsed.nanogpt && !parsed.standing) {
      const ng = parsed.nanogpt
      return {
        standing: { ...DEFAULT_CONFIG.standing, ...ng },
        avatar: { ...DEFAULT_CONFIG.avatar, ...ng },
        cg: { ...DEFAULT_CONFIG.cg, ...ng },
        promptEnhancer: { ...DEFAULT_CONFIG.promptEnhancer, ...parsed.promptEnhancer },
      }
    }
    return {
      standing: { ...DEFAULT_CONFIG.standing, ...parsed.standing },
      avatar: { ...DEFAULT_CONFIG.avatar, ...parsed.avatar },
      cg: { ...DEFAULT_CONFIG.cg, ...parsed.cg },
      promptEnhancer: { ...DEFAULT_CONFIG.promptEnhancer, ...parsed.promptEnhancer },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveImageAPIConfig(config: ImageAPIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

// ============================================================================
// Helpers
// ============================================================================

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

// ============================================================================
// NanoGPT API
// ============================================================================

interface NanoGPTResponse {
  data?: Array<{ url?: string; base64?: string; b64_json?: string }>
  url?: string
  base64?: string
}

async function callNanoGPT(
  modelConfig: ImageModelConfig,
  input: { prompt: string; resolution?: string; imageDataUrl?: string },
): Promise<ImageAPIResponse> {
  if (!modelConfig.endpoint || !modelConfig.apiKey) throw new Error('Image API not configured')

  // 解析用户自定义额外参数
  let extra: Record<string, any> = {}
  if (modelConfig.extraParams) {
    try { extra = JSON.parse(modelConfig.extraParams) } catch {}
  }

  const body: Record<string, any> = {
    prompt: input.prompt,
    model: modelConfig.model,
    nImages: 1,
    showExplicitContent: false,
    ...extra,
  }

  if (input.resolution) body.resolution = input.resolution
  if (input.imageDataUrl) body.imageDataUrl = input.imageDataUrl

  const res = await fetch(modelConfig.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': modelConfig.apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Image API failed (${res.status}): ${text}`)
  }

  const json: NanoGPTResponse = await res.json()

  if (json.data && json.data.length > 0) {
    return {
      data: json.data.map(d => ({
        url: d.url,
        b64_json: d.base64 || d.b64_json,
      })),
    }
  }

  if (json.url || json.base64) {
    return { data: [{ url: json.url, b64_json: json.base64 }] }
  }

  throw new Error('No image data in API response')
}

// ============================================================================
// Resolution helpers
// ============================================================================

function isSeedream(model: string): boolean {
  return model.toLowerCase().includes('seedream')
}

function standingResolution(model: string): string {
  return isSeedream(model) ? '1664*2496' : '720*1280'
}

function avatarResolution(model: string): string {
  return isSeedream(model) ? '2048*2048' : '1024*1024'
}

function cgResolution(model: string): string {
  return isSeedream(model) ? '2496*1664' : '1280*720'
}

// ============================================================================
// Public API
// ============================================================================

/** 生成立绘（文生图） */
export async function generateStanding(input: ImageGenerationInput): Promise<ImageAPIResponse> {
  const config = loadImageAPIConfig().standing
  return callNanoGPT(config, {
    prompt: input.prompt,
    resolution: input.resolution || standingResolution(config.model),
  })
}

/** 生成表情头像（图生图） */
export async function generateAvatar(input: {
  image: Blob | string
  prompt: string
  resolution?: string
}): Promise<ImageAPIResponse> {
  const config = loadImageAPIConfig().avatar
  let imageDataUrl: string
  if (typeof input.image === 'string') {
    imageDataUrl = input.image.startsWith('data:') ? input.image : `data:image/png;base64,${input.image}`
  } else {
    imageDataUrl = await blobToBase64(input.image)
  }
  return callNanoGPT(config, {
    prompt: input.prompt,
    resolution: input.resolution || avatarResolution(config.model),
    imageDataUrl,
  })
}

/** 生成 CG（预留） */
export async function generateCG(input: ImageGenerationInput): Promise<ImageAPIResponse> {
  const config = loadImageAPIConfig().cg
  return callNanoGPT(config, {
    prompt: input.prompt,
    resolution: input.resolution || cgResolution(config.model),
    imageDataUrl: input.imageDataUrl,
  })
}

// ============================================================================
// Prompt Enhancer
// ============================================================================

export function isPromptEnhancerConfigured(): boolean {
  const config = loadImageAPIConfig().promptEnhancer
  return !!(config.endpoint && config.apiKey && config.model)
}

export async function enhancePrompt(rawPrompt: string): Promise<string> {
  const config = loadImageAPIConfig().promptEnhancer
  if (!config.endpoint || !config.apiKey || !config.model) {
    return rawPrompt
  }

  const systemPrompt = `你是一个图像生成 prompt 改写专家。你的任务是将角色外貌描述改写为图像生成模型能准确绘制的、温和的视觉描述。

核心原则：图像生成模型会把所有形容词都当成字面意思来画。"极度丰满"会生成畸形肥胖，"硕大的胸部"会生成不合比例的身体。你必须将所有夸张描述降级为正常人体范围内的温和描述。

禁止出现的词汇（必须替换）：
- 程度副词："极度""极其""超级""非常""异常""格外""十分" → 全部删除或替换为温和表述
- 夸张体型词："硕大""巨大""肥大""沉重肉感" → 替换为"丰满""圆润""饱满"等正常描述
- 比喻修辞："如瀑布般""星辰般""宝石般" → 替换为具体视觉特征
- 色情暗示词："肉感""深V""紧贴身体" → 替换为正常服装描述

转换示例：
- "极度丰满的葫芦型身材" → "曲线明显的沙漏型身材"
- "硕大且具有沉重肉感的胸部" → "胸部较为丰满"
- "浑圆肥大的倒心形臀部" → "臀部圆润"
- "小骨架的身体" → "体型娇小纤细"
- "如瀑布般的长发" → "黑色直长发，长度到腰部"

其他规则：
1. 保留具体视觉信息：发色、发型、瞳色、肤色、服装款式、配饰等
2. 用简洁直白的描述性语言，每个特征用逗号分隔
3. 不要添加原文中没有的特征
4. 只输出改写后的文本，不要有任何解释`

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: rawPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  })

  if (!res.ok) {
    console.warn('Prompt enhancer failed, using raw prompt:', res.status)
    return rawPrompt
  }

  const data = await res.json()
  const enhanced = data.choices?.[0]?.message?.content?.trim()
  return enhanced || rawPrompt
}
