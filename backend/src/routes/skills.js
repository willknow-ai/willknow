import { Router } from 'express'
import { searchSkills, fetchSkill } from '../services/skills.js'

const router = Router()

// 搜索技能（支持 registry=skills.sh|clawhub）
router.get('/skills/search', async (req, res) => {
  const { q, registry = 'skills.sh' } = req.query
  if (!q) return res.json([])
  try {
    const results = await searchSkills(String(q), String(registry))
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 拉取并解析技能（不写入 config，由前端管理状态后调 PUT /api/settings 保存）
router.post('/skills/fetch', async (req, res) => {
  const { id, registry = 'skills.sh' } = req.body
  if (!id) return res.status(400).json({ error: 'id is required' })
  try {
    const skill = await fetchSkill(id, String(registry))
    res.json({ ok: true, skill })
  } catch (err) {
    res.json({ ok: false, error: err.message })
  }
})

export default router
