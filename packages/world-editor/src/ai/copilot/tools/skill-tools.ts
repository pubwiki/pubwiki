/**
 * Skill Tools — list_skills / get_skill_content
 *
 * Reads skill markdown files from a VFS-backed SkillFileProvider.
 * Each .md file in the VFS is a skill; the filename (without extension) is the skill ID.
 * YAML frontmatter provides title and description metadata.
 *
 * Tracks which skills have been read for Skill-First guard enforcement.
 */

import { z } from 'zod'
import { defineTool } from '@pubwiki/chat'
import { markSkillRead } from './state-tools'

// ============================================================================
// Skill File Provider Interface
// ============================================================================

/**
 * Abstraction for reading skill files from a VFS or other storage.
 * Implemented by the studio app using NodeVfs.
 */
export interface SkillFileProvider {
  /** List all .md filenames in the skill directory (e.g. ['workflow.md', 'statedata_schema.md']) */
  listFiles(): Promise<string[]>
  /** Read a file's UTF-8 content. Returns null if not found. */
  readFile(filename: string): Promise<string | null>
}

/** No-op provider for when skill VFS is not available */
const EMPTY_PROVIDER: SkillFileProvider = {
  listFiles: async () => [],
  readFile: async () => null,
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

interface SkillMeta {
  id: string
  title: string
  description: string
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Expects the format:
 * ```
 * ---
 * title: ...
 * description: ...
 * ---
 * ```
 */
function parseSkillMeta(filename: string, content: string): SkillMeta {
  const id = filename.replace(/\.md$/i, '')
  let title = id
  let description = ''

  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (match) {
    const frontmatter = match[1]
    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m)
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
    if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, '')
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '')
  }

  return { id, title, description }
}

/**
 * Strip YAML frontmatter from content, returning only the body.
 */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Lazy getter type — the provider may not be available at tool registration time.
 */
type SkillFileProviderGetter = () => SkillFileProvider | null

/**
 * list_skills — List all available skills from the skill VFS.
 */
export function createListSkillsTool(getProvider: SkillFileProviderGetter) {
  return defineTool({
    name: 'list_skills',
    description: '列出所有可用的技能文档。',
    schema: z.object({}),
    handler: async () => {
      const provider = getProvider() ?? EMPTY_PROVIDER
      const files = await provider.listFiles()
      const mdFiles = files.filter(f => f.endsWith('.md'))

      if (mdFiles.length === 0) {
        return '没有可用的技能文档。'
      }

      const lines = ['# 📚 Available Skills']
      lines.push('')

      for (const filename of mdFiles) {
        const content = await provider.readFile(filename)
        if (!content) continue
        const meta = parseSkillMeta(filename, content)
        const star = meta.id.includes('schema') ? ' ⭐' : ''
        lines.push(`- \`${meta.id}\`${star} — ${meta.description || meta.title}`)
      }

      lines.push('')
      lines.push('> Use `get_skill_content(id)` to read a skill\'s full content.')
      return lines.join('\n')
    },
  })
}

/**
 * get_skill_content — Read a skill's full content.
 * Also tracks which skills have been read for Skill-First guard.
 */
export function createGetSkillContentTool(getProvider: SkillFileProviderGetter) {
  return defineTool({
    name: 'get_skill_content',
    description: '读取指定技能文档的完整内容。用于在执行任务前学习相关知识。',
    schema: z.object({
      id: z.string().describe('Skill ID (filename without .md extension)'),
    }),
    handler: async ({ id }) => {
      const provider = getProvider() ?? EMPTY_PROVIDER

      // Try with .md extension
      const content = await provider.readFile(`${id}.md`)
      if (content) {
        markSkillRead(id)
        return stripFrontmatter(content)
      }

      // Try exact filename (in case user passed 'foo.md')
      if (id.endsWith('.md')) {
        const content2 = await provider.readFile(id)
        if (content2) {
          const bareId = id.replace(/\.md$/i, '')
          markSkillRead(bareId)
          return stripFrontmatter(content2)
        }
      }

      return `错误: 找不到技能 "${id}"。使用 list_skills() 查看所有可用技能。`
    },
  })
}
