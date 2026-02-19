import fetch from 'node-fetch'

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Handles simple key: value pairs and one-level nested metadata block.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const yamlStr = match[1]
  const body = match[2]
  const frontmatter = {}

  let inMetadata = false
  for (const line of yamlStr.split('\n')) {
    const trimmed = line.trimEnd()

    if (trimmed === 'metadata:') {
      inMetadata = true
      frontmatter.metadata = {}
      continue
    }

    if (inMetadata) {
      if (trimmed.startsWith('  ')) {
        const colonIdx = trimmed.indexOf(':')
        if (colonIdx !== -1) {
          const key = trimmed.slice(0, colonIdx).trim()
          const val = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
          frontmatter.metadata[key] = val
        }
        continue
      } else {
        inMetadata = false
      }
    }

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const val = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) frontmatter[key] = val
  }

  return { frontmatter, body }
}

/**
 * Proxy search to skills.sh API
 */
export async function searchSkills(q) {
  const res = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`skills.sh 搜索失败: ${res.status}`)
  return res.json()
}

/**
 * Fetch and parse a skill from GitHub given its skills.sh id ("owner/repo/skillId")
 */
export async function fetchSkill(id) {
  const lastSlash = id.lastIndexOf('/')
  if (lastSlash === -1) throw new Error('无效的 skill id，格式应为 owner/repo/skillId')

  const source = id.slice(0, lastSlash)   // "resend/resend-skills"
  const skillId = id.slice(lastSlash + 1) // "send-email"

  // Try main branch first, then master
  let content = null
  for (const branch of ['main', 'master']) {
    const url = `https://raw.githubusercontent.com/${source}/${branch}/${skillId}/SKILL.md`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (res.ok) {
      content = await res.text()
      break
    }
  }

  if (!content) throw new Error(`未找到技能 "${id}" 的 SKILL.md 文件`)

  const { frontmatter } = parseFrontmatter(content)

  // Check for scripts/ directory via GitHub contents API
  let hasScripts = false
  try {
    const apiUrl = `https://api.github.com/repos/${source}/contents/${skillId}`
    const apiRes = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (apiRes.ok) {
      const files = await apiRes.json()
      hasScripts = Array.isArray(files) && files.some(f => f.name === 'scripts' && f.type === 'dir')
    }
  } catch {
    // Not critical — default to false
  }

  return {
    id,
    name: frontmatter.name || skillId,
    description: frontmatter.description || '',
    version: frontmatter.metadata?.version,
    source,
    skillsShUrl: `https://skills.sh/${id}`,
    content,
    hasScripts,
    enabled: true,
    installedAt: Date.now(),
  }
}
