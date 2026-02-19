import fetch from 'node-fetch'
import AdmZip from 'adm-zip'

const CLAWHUB_DOWNLOAD_BASE = 'https://wry-manatee-359.convex.site/api/v1'

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

// ─── skills.sh ───────────────────────────────────────────────────────────────

/**
 * Proxy search to skills.sh API
 */
export async function searchSkillsSh(q) {
  const res = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`skills.sh 搜索失败: ${res.status}`)
  const data = await res.json()
  // Returns { skills: [...], count, query, duration_ms }
  return (data.skills ?? data ?? []).map(r => ({
    id: r.id,            // "owner/repo/skillId"
    name: r.name || r.skillId,
    installs: r.installs,
    source: r.source,    // "owner/repo"
    registry: 'skills.sh',
  }))
}

/**
 * Fetch and parse a skill from GitHub given its skills.sh id ("owner/repo/skillId")
 */
export async function fetchSkillSh(id) {
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

  // Check for scripts/ directory via GitHub contents API, and download script/dep files
  let hasScripts = false
  let scripts = {}
  try {
    const apiUrl = `https://api.github.com/repos/${source}/contents/${skillId}`
    const apiRes = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (apiRes.ok) {
      const files = await apiRes.json()
      hasScripts = Array.isArray(files) && files.some(f => f.name === 'scripts' && f.type === 'dir')

      // 下载根目录中的依赖文件（requirements.txt / package.json / Gemfile）
      if (Array.isArray(files)) {
        const DEP_FILES = ['requirements.txt', 'package.json', 'Gemfile']
        await Promise.all(
          files.filter(f => f.type === 'file' && DEP_FILES.includes(f.name) && f.download_url).map(async f => {
            const r = await fetch(f.download_url, { signal: AbortSignal.timeout(10000) })
            if (r.ok) scripts[f.name] = await r.text()
          })
        )
      }
    }
  } catch {
    // Not critical — default to false
  }

  // 下载 scripts/ 目录中的所有文件
  if (hasScripts) {
    try {
      const sRes = await fetch(
        `https://api.github.com/repos/${source}/contents/${skillId}/scripts`,
        { headers: { 'Accept': 'application/vnd.github.v3+json' }, signal: AbortSignal.timeout(8000) }
      )
      if (sRes.ok) {
        const sFiles = await sRes.json()
        if (Array.isArray(sFiles)) {
          await Promise.all(
            sFiles.filter(f => f.type === 'file' && f.download_url).map(async f => {
              const r = await fetch(f.download_url, { signal: AbortSignal.timeout(10000) })
              if (r.ok) scripts[`scripts/${f.name}`] = await r.text()
            })
          )
        }
      }
    } catch {
      // 下载失败不阻止安装
    }
  }

  return {
    id,
    name: frontmatter.name || skillId,
    description: frontmatter.description || '',
    version: frontmatter.metadata?.version,
    registry: 'skills.sh',
    registryUrl: `https://skills.sh/${id}`,
    source,
    content,
    hasScripts,
    scripts,
    enabled: true,
    installedAt: Date.now(),
  }
}

// ─── clawhub.ai ──────────────────────────────────────────────────────────────

const SCRIPT_EXTENSIONS = /\.(py|sh|js|ts|rb|go|rs|pl|php|bash|zsh|fish|ps1|bat|cmd)$/i

/**
 * Proxy search to clawhub.ai API
 */
export async function searchClawhub(q) {
  const res = await fetch(`https://clawhub.ai/api/search?q=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`clawhub.ai 搜索失败: ${res.status}`)
  const data = await res.json()
  // Returns { results: [{ slug, displayName, summary, version, score, updatedAt }] }
  return (data.results ?? []).map(r => ({
    id: `clawhub:${r.slug}`,
    name: r.displayName || r.slug,
    summary: r.summary,    // clawhub returns description in search results
    source: r.slug,
    registry: 'clawhub',
  }))
}

/**
 * Fetch and install a skill from clawhub.ai by slug.
 * Downloads the zip, extracts SKILL.md, checks for scripts.
 */
export async function fetchClawhubSkill(slug) {
  // 1. Get skill detail to retrieve version and owner handle
  const detailRes = await fetch(`https://clawhub.ai/api/skill?slug=${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!detailRes.ok) throw new Error(`获取技能详情失败: ${detailRes.status}`)
  const detail = await detailRes.json()

  const version = detail.latestVersion?.version
  if (!version) throw new Error(`无法获取技能版本信息: ${slug}`)
  const ownerHandle = detail.owner?.handle || 'unknown'

  // 2. Download zip from Convex storage
  const zipUrl = `${CLAWHUB_DOWNLOAD_BASE}/download?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(version)}`
  const zipRes = await fetch(zipUrl, { signal: AbortSignal.timeout(15000) })
  if (!zipRes.ok) throw new Error(`下载技能包失败: ${zipRes.status}`)

  const zipBuffer = Buffer.from(await zipRes.arrayBuffer())
  const zip = new AdmZip(zipBuffer)

  // 3. Extract SKILL.md content
  const skillMdEntry = zip.getEntry('SKILL.md')
  if (!skillMdEntry) throw new Error(`技能包中未找到 SKILL.md 文件`)
  const content = skillMdEntry.getData().toString('utf8')

  // 4. Extract script and dependency files from ZIP
  const entries = zip.getEntries()
  const META_FILES = new Set(['SKILL.md', 'README.md', '_meta.json'])
  const DEP_FILES = new Set(['requirements.txt', 'package.json', 'Gemfile'])

  const hasScripts = entries.some(e =>
    !e.isDirectory &&
    !META_FILES.has(e.entryName) &&
    SCRIPT_EXTENSIONS.test(e.entryName)
  )

  const scripts = {}
  if (hasScripts) {
    entries.forEach(e => {
      if (e.isDirectory || META_FILES.has(e.entryName)) return
      if (SCRIPT_EXTENSIONS.test(e.entryName) || DEP_FILES.has(e.entryName)) {
        scripts[e.entryName] = e.getData().toString('utf8')
      }
    })
  }

  const { frontmatter } = parseFrontmatter(content)

  return {
    id: `clawhub:${slug}`,
    name: frontmatter.name || slug,
    description: detail.skill?.summary || frontmatter.description || '',
    version,
    registry: 'clawhub',
    registryUrl: `https://clawhub.ai/${ownerHandle}/${slug}`,
    source: `${ownerHandle}/${slug}`,
    content,
    hasScripts,
    scripts,
    enabled: true,
    installedAt: Date.now(),
  }
}

// ─── Unified exports ──────────────────────────────────────────────────────────

export async function searchSkills(q, registry = 'skills.sh') {
  if (registry === 'clawhub') return searchClawhub(q)
  return searchSkillsSh(q)
}

export async function fetchSkill(id, registry = 'skills.sh') {
  if (registry === 'clawhub') {
    const slug = id.startsWith('clawhub:') ? id.slice(8) : id
    return fetchClawhubSkill(slug)
  }
  return fetchSkillSh(id)
}
