import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { tmpdir } from 'node:os'

const OUTPUT_LIMIT = 50 * 1024  // 50 KB
const TIMEOUT_MS   = 120_000    // 120 s (含依赖安装)

// 语言 → Docker 镜像 + 解释器命令
const LANG_MAP = {
  '.py':   { image: 'python:3.12-slim', cmd: ['python']         },
  '.js':   { image: 'node:20-slim',     cmd: ['node']           },
  '.sh':   { image: 'alpine',           cmd: ['sh']             },
  '.bash': { image: 'alpine',           cmd: ['sh']             },
  '.rb':   { image: 'ruby:3-slim',      cmd: ['ruby']           },
  '.ts':   { image: 'node:20-slim',     cmd: ['npx', 'ts-node'] },
}

// 依赖 manifest → 安装命令（在 wrapper 脚本中使用）
const DEP_INSTALL = {
  'requirements.txt': 'pip install -q --no-cache-dir -r requirements.txt',
  'package.json':     'npm install --quiet',
  'Gemfile':          'bundle install --quiet',
}

// 模块级 Docker 可用性缓存
let _dockerAvailable = false

/**
 * 在 index.js 启动时调用一次，检测 Docker 是否可用
 */
export async function initDocker() {
  try {
    await _spawnPromise('docker', ['info'], 8000)
    _dockerAvailable = true
    console.log('[executor] Docker is available')
  } catch {
    _dockerAvailable = false
    console.warn('[executor] Docker not available — skill script execution disabled')
  }
}

export const isDockerAvailable = () => _dockerAvailable

/**
 * 在 Docker 容器内执行 skill 脚本
 * @param {object} skill        - SkillConfig（需含 skill.scripts）
 * @param {string} scriptPath   - 相对路径，如 "scripts/analyze.py"
 * @param {string} argsStr      - CLI 参数字符串，如 "file.pdf --pages 2"
 * @returns {{ stdout, stderr, exitCode }}
 */
export async function runScript(skill, scriptPath, argsStr) {
  if (!_dockerAvailable) {
    return { stdout: '', stderr: 'Docker is not available on this system.', exitCode: 1 }
  }

  // 路径安全检查
  if (scriptPath.startsWith('/') || scriptPath.startsWith('\\') || scriptPath.includes('..')) {
    return { stdout: '', stderr: `Invalid script path: ${scriptPath}`, exitCode: 1 }
  }
  const safePath = join(scriptPath)

  const ext = extname(safePath).toLowerCase()
  const lang = LANG_MAP[ext]
  if (!lang) {
    return { stdout: '', stderr: `Unsupported script type: ${ext}. Supported: ${Object.keys(LANG_MAP).join(', ')}`, exitCode: 1 }
  }

  const scripts = skill.scripts ?? {}
  if (!scripts[safePath]) {
    const available = Object.keys(scripts).join(', ') || '(none)'
    return { stdout: '', stderr: `Script not found: ${safePath}. Available: ${available}`, exitCode: 1 }
  }

  // 创建临时目录，写入所有脚本文件
  const tmpDir = await mkdtemp(join(tmpdir(), 'willknow-skill-'))
  try {
    // 写入 skill 的所有脚本/依赖文件
    await Promise.all(
      Object.entries(scripts).map(async ([relPath, content]) => {
        const dest = join(tmpDir, relPath)
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, content, 'utf8')
      })
    )

    // 生成 wrapper 脚本（负责依赖安装 + 执行目标脚本）
    const wrapperLines = ['#!/bin/sh', 'set -e', '']
    for (const [manifest, installCmd] of Object.entries(DEP_INSTALL)) {
      if (scripts[manifest] !== undefined) {
        wrapperLines.push(`if [ -f ${manifest} ]; then`, `  ${installCmd}`, 'fi', '')
      }
    }
    // exec 目标脚本，通过 "$@" 传入 args
    wrapperLines.push(`exec ${lang.cmd.join(' ')} ${safePath} "$@"`)
    const wrapperContent = wrapperLines.join('\n') + '\n'
    await writeFile(join(tmpDir, '__willknow_run__.sh'), wrapperContent, 'utf8')

    // 解析 args 字符串为数组（不经过 shell，避免注入）
    const scriptArgs = argsStr?.trim() ? argsStr.trim().split(/\s+/) : []

    const dockerArgs = [
      'run', '--rm',
      '--memory=256m',
      '--cpus=0.5',
      '-v', `${tmpDir}:/workspace`,
      '-w', '/workspace',
      lang.image,
      'sh', '__willknow_run__.sh',
      ...scriptArgs,
    ]

    return await _spawnPromise('docker', dockerArgs, TIMEOUT_MS)

  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── 内部辅助 ──────────────────────────────────────────────────────────────

function _spawnPromise(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdoutBuf = Buffer.alloc(0)
    let stderrBuf = Buffer.alloc(0)
    let timedOut = false

    const timer = timeoutMs
      ? setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, timeoutMs)
      : null

    proc.stdout.on('data', chunk => {
      stdoutBuf = Buffer.concat([stdoutBuf, chunk])
      if (stdoutBuf.length > OUTPUT_LIMIT) stdoutBuf = stdoutBuf.subarray(0, OUTPUT_LIMIT)
    })
    proc.stderr.on('data', chunk => {
      stderrBuf = Buffer.concat([stderrBuf, chunk])
      if (stderrBuf.length > OUTPUT_LIMIT) stderrBuf = stderrBuf.subarray(0, OUTPUT_LIMIT)
    })

    proc.on('close', code => {
      if (timer) clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`Script timed out after ${timeoutMs / 1000}s`))
        return
      }
      // 用于 initDocker 的 docker info 检查
      if (cmd === 'docker' && args[0] === 'info' && code !== 0) {
        reject(new Error('docker info failed'))
        return
      }
      resolve({
        stdout: stdoutBuf.toString('utf8'),
        stderr: stderrBuf.toString('utf8'),
        exitCode: code ?? 1,
      })
    })

    proc.on('error', err => {
      if (timer) clearTimeout(timer)
      // initDocker 失败时 reject，runScript 时返回错误信息
      if (cmd === 'docker' && args[0] === 'info') {
        reject(err)
      } else {
        resolve({ stdout: '', stderr: err.message, exitCode: 1 })
      }
    })
  })
}
