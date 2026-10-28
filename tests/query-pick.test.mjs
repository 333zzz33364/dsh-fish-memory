// ⭐ 1.4.0：检索用的那句话必须是「这一轮真正说的」——
//   以前优先用 agent/inbox/inserted 监听收到的那句，可那个事件不是每轮都来，
//   一旦不来 query 就永远停在上一次那句（实测 76 次注入只收到 24 次消息事件），
//   于是每一轮都召回同一条记忆。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { tmpdir } from 'node:os'
process.env.DSH_HOME = process.env.DSH_HOME || tmpdir()
const 模 = await import('../lib/index.js?q=' + Date.now())

test('会话里有新话时，用它而不是监听那句（监听卡住也不会一直用旧的）', () => {
  assert.equal(模.选查询词('最新的这句', '你好'), '最新的这句')
})

test('会话读不出来时，退回监听那句', () => {
  assert.equal(模.选查询词('', '你好'), '你好')
})

test('两边都空就是空（上层会跳过注入）', () => {
  assert.equal(模.选查询词('', ''), '')
})

test('只有空白也算空', () => {
  assert.equal(模.选查询词('   ', ' 你好 '), '你好')
})

const 换行 = String.fromCharCode(10)

test('运行环境那几行会被剥掉，只留人说的话', () => {
  const 原 = '宝宝你在吗' + 换行
    + 'Current runtime context. This snapshot supersedes earlier snapshots.' + 换行
    + 'Current working directory: C:/x' + 换行
    + 'Time sampled: 00:00'
  assert.equal(模.清掉注入上下文(原), '宝宝你在吗')
})

test('没有那种上下文就原样保留', () => {
  const 原 = '第一行' + 换行 + '第二行'
  assert.equal(模.清掉注入上下文(原), 原)
})

test('整句都是上下文时，退回原文（总比空着强）', () => {
  const 原 = 'Current runtime context. 只有这一行'
  assert.ok(模.清掉注入上下文(原).length > 0)
})

test('【你记得的事】那种整块提醒，从标题跳到最后（到空行为止）', () => {
  const 原 = '【你记得的事】' + 换行 + '下面是你们过去真实发生过的事。' + 换行 + '有时间就按那个时间说。' + 换行 + 换行 + '宝宝我想吃火锅'
  assert.equal(模.清掉注入上下文(原), '宝宝我想吃火锅')
})

test('提醒在后面时，前面的正文不受影响', () => {
  const 原 = '宝宝我想吃火锅' + 换行 + '【你记得的事】' + 换行 + '一段提醒' + 换行 + 换行 + '那就去吃'
  assert.equal(模.清掉注入上下文(原), '宝宝我想吃火锅' + 换行 + 换行 + '那就去吃')
})
