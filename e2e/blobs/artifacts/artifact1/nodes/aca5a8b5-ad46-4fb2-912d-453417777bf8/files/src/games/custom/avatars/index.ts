/**
 * Avatar Registry — 角色表情头像静态注册表
 *
 * 开发者在此注册角色头像。文件放在 avatars/{creatureId}/ 目录下。
 * 支持的表情: normal, happy, angry, sad, surprised, shy, disgusted, dazed
 *
 * 使用方式:
 *   1. 将头像图片放入 avatars/{creatureId}/ 目录
 *   2. 在下方 import 并注册到 avatarRegistry
 *
 * 示例:
 *   import aliceNormal from './alice/normal.png'
 *   import aliceHappy from './alice/happy.png'
 *
 *   avatarRegistry['alice'] = {
 *     normal: aliceNormal,
 *     happy: aliceHappy,
 *   }
 */

import type { GalExpression } from '../types'

type AvatarMap = Record<string, Partial<Record<GalExpression, string>>>

const avatarRegistry: AvatarMap = {
  // ── 在这里注册你的角色头像 ──
  // 'creature_id': {
  //   normal: importedNormalUrl,
  //   happy: importedHappyUrl,
  // },
}

export default avatarRegistry

/**
 * 获取角色头像 URL
 * 优先精确匹配表情，fallback 到 normal
 */
export function getAvatarUrl(creatureId: string, expression?: GalExpression): string | null {
  const entry = avatarRegistry[creatureId]
  if (!entry) return null

  const expr = expression || 'normal'
  if (entry[expr]) return entry[expr]!
  if (expr !== 'normal' && entry.normal) return entry.normal
  return null
}
