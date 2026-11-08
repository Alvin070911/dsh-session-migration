import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeSegment, isFullyQualified, isInside, projectKey, samePath } from '../lib/paths.js'

test('projectKey matches the persistence package vectors', () => {
  assert.equal(projectKey('C:\\AI-Player'), '--C-AI-Player--')
  assert.equal(projectKey('C:\\Agent-Project\\AI-Player'), '--C-Agent-Project-AI-Player--')
  assert.equal(
    projectKey('C:\\Agent-Project\\项目地址移迁'),
    '--C-Agent-Project-~9879~76EE~5730~5740~79FB~8FC1--',
  )
  assert.equal(
    projectKey('C:\\Users\\Alvin\\DSH Desktop\\插件'),
    '--C-Users-Alvin-DSH~0020Desktop-~63D2~4EF6--',
  )
})

test('projectKey collapses separator runs and keeps dots and dashes', () => {
  assert.equal(projectKey('C:/a//b\\\\c'), '--C-a-b-c--')
  assert.equal(projectKey('C:\\a.b-c_d'), '--C-a.b-c_d--')
  assert.equal(projectKey('~/x'), '--~007E-x--', 'a literal tilde is escaped so keys stay unambiguous')
})

test('projectKey is bounded to 251 readable characters', () => {
  const key = projectKey(`C:\\${'a'.repeat(400)}`)
  assert.equal(key.length, 251 + 4)
  assert.ok(key.startsWith('--C-a'))
  assert.ok(key.endsWith('--'))
})

test('projectKey rejects an empty path', () => {
  assert.throws(() => projectKey(''), /empty project path/)
})

test('encodeSegment round-trips session ids and escapes unsafe segments', () => {
  assert.equal(encodeSegment('session-43eccc2c-b774-4eba-9e3b-36284c491e13'), 'session-43eccc2c-b774-4eba-9e3b-36284c491e13')
  assert.equal(encodeSegment('.'), '~002E')
  assert.equal(encodeSegment('..'), '~002E~002E')
  assert.equal(encodeSegment('a b'), 'a~0020b')
  assert.equal(encodeSegment('a~b'), 'a~007Eb')
})

test('isFullyQualified accepts drive paths and rejects drive-relative ones', () => {
  assert.equal(isFullyQualified('C:\\x', 'win32'), true)
  assert.equal(isFullyQualified('C:', 'win32'), false)
  assert.equal(isFullyQualified('\\\\server\\share', 'win32'), true)
  assert.equal(isFullyQualified('/usr/local', 'linux'), true)
  assert.equal(isFullyQualified('relative/path', 'linux'), false)
})

test('samePath honours platform casing', () => {
  assert.equal(samePath('C:\\Foo\\', 'c:\\foo', 'win32'), true)
  assert.equal(samePath('/Foo', '/foo', 'linux'), false)
})

test('isInside treats a path as inside itself and below it', () => {
  assert.equal(isInside('C:\\a', 'C:\\a\\b', 'win32'), true)
  assert.equal(isInside('C:\\a', 'C:\\AB', 'win32'), false)
  assert.equal(isInside('/a', '/a/b/c', 'linux'), true)
})
