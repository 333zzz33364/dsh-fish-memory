// 从会话生成档案：会话文件名与提示词占位的回归测试
//
// 背景：DSH 0.2.1 起会话落盘成 `session.v4.jsonl.zstd`，插件原来只认 v3 /
// 无版本号两种名字，于是「这个工作区里找到 0 个」，整个功能点不动。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 列会话, 拼输入 } from '../lib/生成档案.js'

// 在临时「DSH 家目录」里造一个 sessions/<工作区>/<会话>/<文件名>
const 造会话 = (根, 工作区, sid, 文件名) => {
  const 目录 = join(根, 'sessions', 工作区, sid)
  mkdirSync(目录, { recursive: true })
  writeFileSync(join(目录, 文件名), '')
  return 目录
}

const 用临时根 = (跑) => {
  const 根 = mkdtempSync(join(tmpdir(), 'fish-memory-gen-'))
  try {
    return 跑(根)
  } finally {
    rmSync(根, { recursive: true, force: true })
  }
}

test('认 session.v4.jsonl.zstd', () => {
  用临时根((根) => {
    造会话(根, '--ws--', 'v4', 'session.v4.jsonl.zstd')
    const 出 = 列会话(根)
    assert.equal(出.length, 1)
    assert.equal(出[0].sid, 'v4')
    assert.ok(出[0].路径.endsWith('session.v4.jsonl.zstd'))
  })
})

test('老的 v3 与无版本号名字照旧认', () => {
  用临时根((根) => {
    造会话(根, '--ws--', 'v3', 'session.v3.jsonl.zstd')
    造会话(根, '--ws--', 'plain', 'session.jsonl.zstd')
    const 出 = 列会话(根).sort((a, b) => a.sid.localeCompare(b.sid))
    assert.deepEqual(出.map((x) => x.sid), ['plain', 'v3'])
  })
})

test('同一会话有多份时取版本最高的那份', () => {
  用临时根((根) => {
    造会话(根, '--ws--', 'both', 'session.v3.jsonl.zstd')
    造会话(根, '--ws--', 'both', 'session.v4.jsonl.zstd')
    const 出 = 列会话(根)
    assert.equal(出.length, 1)
    assert.ok(出[0].路径.endsWith('session.v4.jsonl.zstd'))
  })
})

test('不认识的目录与文件名都跳过', () => {
  用临时根((根) => {
    造会话(根, '--ws--', 'no-file', 'readme.txt')
    mkdirSync(join(根, 'sessions', '--ws--', 'empty'), { recursive: true })
    writeFileSync(join(根, 'sessions', 'stray.txt'), '')
    assert.deepEqual(列会话(根), [])
  })
})

test('提示词末位换成清单，小标题保持原样', () => {
  const 批 = { 天: '2026-10-26', 行: [{ 谁: '用户', 时间: 0, 文: '你好' }] }
  const 空 = 拼输入(批, []).system
  assert.ok(空.includes('【已记清单】（这些不要再收一遍）'), '小标题应当留着')
  assert.ok(空.trimEnd().endsWith('（这是第一批，还没有已记内容）'), '末尾应当换成第一批说明')
  assert.equal((空.match(/【已记清单】/g) || []).length, 1, '整份只需要一个小标题')

  const 有 = 拼输入(批, ['三|2026-10-26|用户喜欢甜食。']).system
  assert.ok(有.trimEnd().endsWith('三|2026-10-26|用户喜欢甜食。'), '末尾应当换成已记清单')
})
