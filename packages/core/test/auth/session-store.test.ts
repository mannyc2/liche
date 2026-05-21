import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileSessionStore, secret } from '../../src/index.js'
import { LiliError } from '../../src/errors/error.js'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'lili-session-'))
}

describe('createFileSessionStore', () => {
  test('persists profiles, active profile, selected contexts, and access tokens', async () => {
    const root = tempRoot()
    try {
      const store = createFileSessionStore({ root })
      await store.saveProfile('acme', 'oauth', 'work', {
        schemaVersion: 1,
        productId: 'acme',
        providerId: 'oauth',
        profile: 'work',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        account: { id: 'u_1', label: 'dev@example.test' },
        selectedContexts: { org: 'org_1' },
        credential: {
          kind: 'bearer',
          accessToken: secret('session-token'),
          expiresAt: '2099-01-01T00:00:00.000Z',
          scopes: ['cache.write'],
        },
      })

      expect(await store.listProfiles('acme', 'oauth')).toEqual(['work'])
      expect(await store.getActiveProfile('acme', 'oauth')).toBe('work')
      const loaded = await store.loadProfile('acme', 'oauth', 'work')
      expect(loaded?.credential?.accessToken?.reveal()).toBe('session-token')
      expect(loaded?.selectedContexts).toEqual({ org: 'org_1' })

      const file = join(root, 'sessions', 'acme.json')
      const text = readFileSync(file, 'utf8')
      expect(text).toContain('session-token')
      expect(text).not.toContain('[redacted]')
      if (process.platform !== 'win32') {
        expect(statSync(join(root, 'sessions')).mode & 0o777).toBe(0o700)
        expect(statSync(file).mode & 0o777).toBe(0o600)
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('deleteProfile and deleteAllProfiles only affect the selected provider', async () => {
    const root = tempRoot()
    try {
      const store = createFileSessionStore({ root })
      for (const providerId of ['a', 'b']) {
        await store.saveProfile('acme', providerId, 'default', {
          schemaVersion: 1,
          productId: 'acme',
          providerId,
          profile: 'default',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        })
      }
      await store.deleteProfile('acme', 'a', 'default')
      expect(await store.listProfiles('acme', 'a')).toEqual([])
      expect(await store.listProfiles('acme', 'b')).toEqual(['default'])
      expect(await store.deleteAllProfiles('acme', 'b')).toBe(1)
      expect(await store.listProfiles('acme', 'b')).toEqual([])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('corrupt JSON is renamed and reported as AUTH_SESSION_CORRUPT', async () => {
    const root = tempRoot()
    try {
      const dir = join(root, 'sessions')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'acme.json'), '{ not json', 'utf8')
      const store = createFileSessionStore({ root })
      let caught: unknown
      try {
        await store.listProfiles('acme', 'oauth')
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(LiliError)
      expect((caught as LiliError).code).toBe('AUTH_SESSION_CORRUPT')
      expect(existsSync(join(dir, 'acme.json'))).toBe(false)
      expect(readdirSync(dir).some((name) => name.startsWith('acme.json.corrupt.'))).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('invalid profile names are rejected before file writes', async () => {
    const root = tempRoot()
    try {
      const store = createFileSessionStore({ root })
      await expect(store.loadProfile('acme', 'oauth', '../bad')).rejects.toThrow(/Invalid auth profile name/)
      expect(existsSync(join(root, 'sessions', 'acme.json'))).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
