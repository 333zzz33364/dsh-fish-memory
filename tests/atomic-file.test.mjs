import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { writeFileAtomicSync } from '../lib/atomic-file.mjs'

const directory = fs.mkdtempSync(join(tmpdir(), 'fish-atomic-file-'))
function seed(name) {
  const path = join(directory, name + '.json')
  fs.writeFileSync(path, '{"old":true}')
  return path
}

test('readers retain the complete old file until the replacement is ready', () => {
  const path = seed('publication')
  const rename = fs.renameSync
  let checked = false
  fs.renameSync = (staged, target) => {
    assert.equal(target, path)
    assert.deepEqual(JSON.parse(fs.readFileSync(path)), { old: true })
    assert.deepEqual(JSON.parse(fs.readFileSync(staged)), { new: '合成星图' })
    checked = true
    return rename(staged, target)
  }
  try { writeFileAtomicSync(path, '{"new":"合成星图"}') }
  finally { fs.renameSync = rename }
  assert.equal(checked, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(path)), { new: '合成星图' })
})

for (const operation of ['openSync', 'closeSync']) {
  test(`${operation} failure leaves the old file and propagates the original error`, () => {
    const path = seed(operation)
    const original = fs[operation]
    const failure = Object.assign(new Error('synthetic ' + operation + ' failure'), { code: 'EIO' })
    let failed = false
    fs[operation] = (...args) => {
      if (!failed) { failed = true; throw failure }
      return original(...args)
    }
    try { assert.throws(() => writeFileAtomicSync(path, '{"new":true}'), error => error === failure) }
    finally { fs[operation] = original }
    assert.deepEqual(JSON.parse(fs.readFileSync(path)), { old: true })
    assert.equal(fs.readdirSync(directory).filter(name => name.startsWith(operation + '.json.') && name.endsWith('.tmp')).length, 0)
  })
}

test('new files publish as readable complete JSON without staging leftovers', () => {
  const path = join(directory, 'new.json')
  writeFileAtomicSync(path, '{"new":true}')
  assert.deepEqual(JSON.parse(fs.readFileSync(path)), { new: true })
  assert.equal(fs.readdirSync(directory).filter(name => name.startsWith('new.json.') && name.endsWith('.tmp')).length, 0)
})

test('replacement preserves existing POSIX access bits', { skip: process.platform === 'win32' }, () => {
  const path = seed('mode')
  fs.chmodSync(path, 0o640)
  const mask = process.umask(0o077)
  try { writeFileAtomicSync(path, '{"new":true}') }
  finally { process.umask(mask) }
  assert.equal(fs.statSync(path).mode & 0o777, 0o640)
})

test('an exclusive-create collision never removes a temporary file owned by another writer', () => {
  const path = seed('collision')
  const open = fs.openSync
  let collision
  fs.openSync = (...args) => {
    if (args[1] === 'wx') {
      collision = args[0]
      const other = open(collision, 'wx')
      fs.writeFileSync(other, 'another writer')
      fs.closeSync(other)
    }
    return open(...args)
  }
  try { assert.throws(() => writeFileAtomicSync(path, '{"new":true}'), { code: 'EEXIST' }) }
  finally { fs.openSync = open }
  assert.equal(fs.readFileSync(collision, 'utf8'), 'another writer')
  assert.deepEqual(JSON.parse(fs.readFileSync(path)), { old: true })
})

test('process exit before rename cannot publish or truncate the staged snapshot', () => {
  const path = seed('interrupted')
  const source = `
    import fs from 'node:fs';
    const { writeFileAtomicSync } = await import(process.argv[1]);
    fs.renameSync = () => process.exit(23);
    writeFileAtomicSync(process.argv[2], '{"new":true}');
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source,
    new URL('../lib/atomic-file.mjs', import.meta.url).href, path], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  assert.ifError(child.error)
  assert.equal(child.status, 23, child.stderr)
  assert.deepEqual(JSON.parse(fs.readFileSync(path)), { old: true })
  const pending = fs.readdirSync(directory).filter(name => name.startsWith('interrupted.json.') && name.endsWith('.tmp'))
  assert.equal(pending.length, 1, 'an abrupt exit can leave an unpublished temporary file')
  assert.deepEqual(JSON.parse(fs.readFileSync(join(directory, pending[0]))), { new: true })
})
