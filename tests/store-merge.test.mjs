import test from 'node:test'
import assert from 'node:assert/strict'
import { 合并库 } from '../lib/store-merge.mjs'

const memory = (id, extra = {}) => ({ id, text: 'fixture ' + id, createdAt: '2026-10-01T00:00:00Z', ...extra })
const store = (memories = [], deleted = []) => ({ version: 2, policy: {}, memories, deleted, traces: [] })
const ids = (items) => items.map((m) => m.id).sort()

test('manual expansion stale snapshot cannot resurrect a later deletion', () => {
  const stale = store([memory('a'), memory('b')])
  const disk = store([memory('b')], [memory('a', { deletedAt: '2026-10-25T00:00:00Z' })])
  stale.memories[1].related = ['expanded']
  stale.memories[1].relatedAt = '2026-10-25T00:01:00Z'
  const result = 合并库(disk, stale)
  assert.deepEqual(ids(result.memories), ['b'])
  assert.deepEqual(ids(result.deleted), ['a'])
  assert.deepEqual(result.memories[0].related, ['expanded'])
})

test('even a later expansion timestamp cannot override deletion', () => {
  const result = 合并库(store([], [memory('a', { deletedAt: '2026-10-25T00:00:00Z' })]),
    store([memory('a', { relatedAt: '2026-10-25T00:01:00Z' })]))
  assert.equal(result.memories.length, 0)
  assert.deepEqual(ids(result.deleted), ['a'])
})

test('an explicit restore restores only selected records', () => {
  const result = 合并库(store([], [memory('a'), memory('b')]), store([memory('a'), memory('b')]), { restoreIds: ['a'] })
  assert.deepEqual(ids(result.memories), ['a'])
  assert.deepEqual(ids(result.deleted), ['b'])
})

test('batch restore preserves unrelated tombstones', () => {
  const result = 合并库(store([], [memory('a'), memory('b'), memory('c')]), store([memory('a'), memory('b')]), { restoreIds: ['a', 'b'] })
  assert.deepEqual(ids(result.memories), ['a', 'b'])
  assert.deepEqual(ids(result.deleted), ['c'])
})

test('a restore id without an active record cannot erase a tombstone', () => {
  const result = 合并库(store([], [memory('a')]), store(), { restoreIds: ['a'] })
  assert.deepEqual(ids(result.deleted), ['a'])
})

test('newly added records and newer disk edits survive an older snapshot', () => {
  const disk = store([memory('a', { text: 'new', editedAt: '2026-10-25T00:00:00Z' }), memory('new')])
  const result = 合并库(disk, store([memory('a')]))
  assert.deepEqual(ids(result.memories), ['a', 'new'])
  assert.equal(result.memories.find(m => m.id === 'a').text, 'new')
})

test('deletion in the current write is also respected', () => {
  const result = 合并库(store([memory('a')]), store([], [memory('a')]))
  assert.equal(result.memories.length, 0)
  assert.deepEqual(ids(result.deleted), ['a'])
})

test('merging the same store is idempotent and does not mutate inputs', () => {
  const input = store([memory('a')], [memory('b')])
  const before = structuredClone(input)
  assert.deepEqual(合并库(input, input), input)
  assert.deepEqual(input, before)
})
