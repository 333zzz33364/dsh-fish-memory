// ⭐ 1.4.5：工作区模式 —— 同一工作区的会话共用一个记忆库
//
// 为什么要有：一个会话久了会大到打开都卡，为了流畅只能归档、开新会话。
// 记忆按会话存的话，新会话里什么都不记得 —— 工作区模式就是治这个的。
//
// 写法照心情插件：**先设 DSH_HOME、再 import**，测试只用这个临时家目录，
// 绝不碰真实的 ~/.dsh。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'fish-ws-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'sessions'), { recursive: true })

const { __测试: api } = await import('../lib/index.js')
after(() => { try { rmSync(home, { recursive: true, force: true }) } catch {} })

const 反斜 = '\\'
const 工作区路径 = 'C:' + 反斜 + 'work' + 反斜 + 'proj'
const 另一个 = 'D:' + 反斜 + 'other'
const wsA = api.工作区目录名(工作区路径)
const wsB = api.工作区目录名(另一个)

// 造两个工作区，各放几个会话
function 造会话(ws, sid) {
  mkdirSync(join(home, 'sessions', ws, sid), { recursive: true })
  writeFileSync(join(home, 'sessions', ws, sid, 'session.v4.jsonl.zstd'), '')
}
造会话(wsA, 'session-aaa')
造会话(wsA, 'session-bbb')
造会话(wsB, 'session-ccc')

const 表 = api.扫会话目录(true)

test('工作区目录名跟 DSH 的算法一字不差', () => {
  assert.equal(wsA, '--C-work-proj--')
  // 带中文的路径：每个非 [A-Za-z0-9._-] 字符都变 ~ + 4 位十六进制
  assert.equal(
    api.工作区目录名('C:' + 反斜 + 'tmp' + 反斜 + '项目'),
    '--C-tmp-~9879~76EE--',
  )
  // 带单引号：' 也转义，不是压成 -
  assert.equal(
    api.工作区目录名('D:' + 反斜 + "ShaoZhu's"),
    '--D-ShaoZhu~0027s--',
  )
})

test('认得出每个会话属于哪个工作区', () => {
  assert.equal(表.bySession.get('session-aaa'), wsA)
  assert.equal(表.bySession.get('session-bbb'), wsA)
  assert.equal(表.bySession.get('session-ccc'), wsB)
})

test('带不带 session- 前缀两种写法都认', () => {
  assert.equal(表.bySession.get('aaa'), wsA)
})

test('按会话模式（默认）时两个会话各是各的库', () => {
  assert.equal(api.库名('session-aaa', { 模式: 'session' }), 'session-aaa')
  assert.equal(api.库名('session-bbb', { 模式: 'session' }), 'session-bbb')
})

test('工作区模式：同一工作区的两个会话指向同一个库', () => {
  const a = api.库名('session-aaa', { 模式: 'workspace' })
  const b = api.库名('session-bbb', { 模式: 'workspace' })
  assert.equal(a, b)
  assert.ok(a.startsWith('ws_'))
})

test('工作区模式：不同工作区指向不同的库', () => {
  assert.notEqual(
    api.库名('session-aaa', { 模式: 'workspace' }),
    api.库名('session-ccc', { 模式: 'workspace' }),
  )
})

test('工作区模式：认不出工作区的会话退回按会话，不会丢记忆', () => {
  assert.equal(api.库名('根本不存在的会话', { 模式: 'workspace' }), '根本不存在的会话')
})
