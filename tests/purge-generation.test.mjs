import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

// Only synthetic stores and fake host/model services; never use the caller's DSH_HOME.
const home = mkdtempSync(join(tmpdir(), 'fish-purge-test-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'empty-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
const plugin = await import('../lib/index.js')
const dir = join(home, 'fish-memory')
mkdirSync(dir, { recursive: true })
const memory = (id) => ({ id, text: '合成记忆 ' + id, createdAt: '2026-10-01T00:00:00Z', related: [] })
const store = (sid, active = ['a', 'b'], deleted = []) => {
  writeFileSync(join(dir, sid + '.json'), JSON.stringify({ version: 2, policy: {},
    memories: active.map(memory), deleted: deleted.map(id => ({ ...memory(id), deletedAt: '2026-10-02T00:00:00Z' })), traces: [] }))
}
const disk = sid => JSON.parse(readFileSync(join(dir, sid + '.json'), 'utf8'))
const ids = entries => entries.map(m => m.id).sort()
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
function host(mod = plugin, liveAgents = []) {
  const routes = new Map()
  const calls = []
  const agent = { options: { provider: 'fixture', model: 'fixture' } }
  const ctx = {
    agents: { list: () => liveAgents, get: () => agent }, sessions: { list: () => [] },
    get: () => null, on: () => () => {}, interval: () => () => {},
    effect: fn => fn(),
    webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } },
    llm: { async *stream() {
      const call = calls.shift()
      assert.ok(call, 'all model calls must be explicitly stubbed')
      call.started.resolve()
      yield { type: 'text-delta', text: await call.reply.promise }
    } },
  }
  mod.apply(ctx)
  return {
    ctx,
    hold() { const call = { started: deferred(), reply: deferred() }; calls.push(call); return call },
    async post(path, body) {
      const handler = routes.get('/dsh-fish-memory' + path)
      assert.ok(handler, 'production route registered: ' + path)
      const req = { url: path, async *[Symbol.asyncIterator]() { yield JSON.stringify(body) } }
      let output
      await handler(req, { writeHead() {}, end(value) { output = JSON.parse(value) } })
      return output
    },
  }
}
const h = host()

for (const action of ['purge', 'purgeall', 'purgebatch']) {
  test(action + ': a delayed expansion cannot restore permanently removed active records', async () => {
    const sid = 'active-' + action
    store(sid)
    const call = h.hold()
    const pending = h.post('/expand', { session: sid })
    await call.started.promise
    assert.equal((await h.post('/delete', { session: sid, id: 'a' })).ok, true)
    assert.equal((await h.post('/delete', { session: sid, action, id: 'a', ids: ['a'] })).ok, true)
    assert.deepEqual(ids(disk(sid).deleted), [], 'purge takes effect immediately')
    const added = await h.post('/add', { session: sid, text: '清理后新记忆' })
    call.reply.resolve('1|旧词 旧事\n2|另外 内容')
    const result = await pending
    assert.deepEqual(ids(disk(sid).memories), ['b', added.id].sort())
    assert.equal(result.ok, false, 'stale model work is reported, not acknowledged as saved')
    assert.match(result.message, /清理|清空/)
    assert.deepEqual(disk(sid).memories.find(m => m.id === 'b').related, [], 'retry the whole stale batch')
    assert.deepEqual(disk(sid).deleted, [])
  })
}

test('purging trash also prevents an old snapshot from restoring deleted payloads', async () => {
  const sid = 'trash-purge'
  store(sid, ['b'], ['trash'])
  const call = h.hold()
  const pending = h.post('/expand', { session: sid })
  await call.started.promise
  await h.post('/delete', { session: sid, action: 'purgeall' })
  call.reply.resolve('1|合成 词语')
  assert.equal((await pending).ok, false)
  assert.deepEqual(disk(sid).deleted, [])
})

test('purgebatch removes only selected trash, and a later explicit restore still works', async () => {
  const sid = 'selective-purge'
  store(sid, ['active'], ['gone', 'kept'])
  const result = await h.post('/delete', { session: sid, action: 'purgebatch', ids: ['gone'] })
  assert.equal(result.ok, true)
  assert.deepEqual(ids(disk(sid).deleted), ['kept'])
  assert.deepEqual(ids(disk(sid).memories), ['active'])
  assert.equal((await h.post('/delete', { session: sid, action: 'restore', id: 'kept' })).ok, true)
  assert.deepEqual(ids(disk(sid).memories), ['active', 'kept'])
  assert.deepEqual(disk(sid).deleted, [])
})

test('ordinary concurrent additions keep working on legacy stores with no epoch', async () => {
  const sid = 'legacy-merge'
  store(sid, ['a'])
  const call = h.hold()
  const pending = h.post('/expand', { session: sid })
  await call.started.promise
  const added = await h.post('/add', { session: sid, text: '并发新增' })
  call.reply.resolve('1|合成 词语')
  assert.equal((await pending).ok, true)
  assert.deepEqual(ids(disk(sid).memories), ['a', added.id].sort())
  assert.deepEqual(disk(sid).memories.find(m => m.id === 'a').related, ['合成', '词语'])
})

test('a fresh task can save after purge and ordinary saves preserve the epoch', async () => {
  const sid = 'fresh-after-purge'
  store(sid, ['a'], ['trash'])
  await h.post('/delete', { session: sid, action: 'purgeall' })
  const epoch = disk(sid).purgeEpoch
  assert.equal(typeof epoch, 'string')
  assert.ok(epoch.length > 0)
  const call = h.hold()
  const pending = h.post('/expand', { session: sid })
  await call.started.promise
  call.reply.resolve('1|新词 内容')
  assert.equal((await pending).ok, true)
  assert.equal(disk(sid).purgeEpoch, epoch)
})

test('another session purge does not invalidate this session', async () => {
  store('unrelated-a', ['a'])
  store('unrelated-b', [], ['trash'])
  const call = h.hold()
  const pending = h.post('/expand', { session: 'unrelated-a' })
  await call.started.promise
  await h.post('/delete', { session: 'unrelated-b', action: 'purgeall' })
  call.reply.resolve('1|合成 词语')
  assert.equal((await pending).ok, true)
})

test('epoch on disk rejects work retained by an older plugin instance', async () => {
  const sid = 'reload-purge'
  store(sid, ['a'])
  const call = h.hold()
  const pending = h.post('/expand', { session: sid })
  await call.started.promise
  const newer = host(await import('../lib/index.js?new-instance'))
  await newer.post('/delete', { session: sid, id: 'a' })
  await newer.post('/delete', { session: sid, action: 'purgeall' })
  call.reply.resolve('1|合成 词语')
  assert.equal((await pending).ok, false)
  assert.deepEqual(disk(sid).memories, [])
  assert.deepEqual(disk(sid).deleted, [])
})

test('explicit copy adopts the destination epoch, not the source epoch', async () => {
  store('copy-from', ['a'], ['trash'])
  store('copy-to', ['b'], ['trash'])
  await h.post('/delete', { session: 'copy-from', action: 'purgeall' })
  await h.post('/delete', { session: 'copy-to', action: 'purgeall' })
  const epoch = disk('copy-to').purgeEpoch
  const result = await h.post('/copy-to', { session: 'copy-from', to: 'copy-to' })
  assert.equal(result.ok, true)
  assert.ok(disk('copy-to').memories.some(m => m.id === 'a'))
  assert.equal(disk('copy-to').purgeEpoch, epoch)
})

test('a corrupt post-purge file fails closed instead of reviving a legacy snapshot', async () => {
  const sid = 'corrupt-after-purge'
  store(sid, ['a'])
  const call = h.hold()
  const pending = h.post('/expand', { session: sid })
  await call.started.promise
  await h.post('/delete', { session: sid, id: 'a' })
  await h.post('/delete', { session: sid, action: 'purgeall' })
  writeFileSync(join(dir, sid + '.json'), '{')
  call.reply.resolve('1|合成 词语')
  assert.equal((await pending).ok, false)
  assert.equal(readFileSync(join(dir, sid + '.json'), 'utf8'), '{', 'failure cannot overwrite the damaged evidence')
})

test('a failed purge write reports failure and leaves the prior store intact', async () => {
  const sid = 'purge-write-failure'
  store(sid, ['active'], ['trash'])
  const path = join(dir, sid + '.json')
  const before = readFileSync(path, 'utf8')
  const realWrite = fs.writeFileSync
  try {
    fs.writeFileSync = (file, ...args) => {
      if (String(file) === path) throw Object.assign(new Error('synthetic write failure'), { code: 'EACCES' })
      return realWrite(file, ...args)
    }
    syncBuiltinESMExports()
    const result = await h.post('/delete', { session: sid, action: 'purgeall' })
    assert.equal(result.ok, false)
    assert.match(result.message, /synthetic write failure/)
    assert.equal(readFileSync(path, 'utf8'), before)
  } finally {
    fs.writeFileSync = realWrite
    syncBuiltinESMExports()
  }
})

test('automatic expansion discards pre-purge work even after an explicit copy restores the same id', async () => {
  const sid = 'auto-purge'
  store(sid, ['a'])
  store('auto-copy-source', ['a'])
  const call = h.hold()
  const pending = plugin.自动扩词(h.ctx, sid)
  await call.started.promise
  await h.post('/delete', { session: sid, id: 'a' })
  await h.post('/delete', { session: sid, action: 'purgeall' })
  assert.equal((await h.post('/copy-to', { session: 'auto-copy-source', to: sid })).ok, true)
  call.reply.resolve('1|过期 结果')
  assert.equal(await pending, 0)
  assert.deepEqual(disk(sid).memories[0].related, [])
})

test('branch inheritance adopts the child epoch rather than its parent epoch', async () => {
  store('fork-source', ['parent'], ['trash'])
  await h.post('/delete', { session: 'fork-source', action: 'purgeall' })
  const child = { session: { id: 'fork-child', header: { id: 'fork-child', parentSession: 'fork-source' } } }
  host(plugin, [child])
  assert.deepEqual(ids(disk('fork-child').memories), ['parent'])
  assert.equal(disk('fork-child').purgeEpoch, '')
})
