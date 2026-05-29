#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { defineCli, defineCommand, fail, help, middleware, outputControls, reflectionControls, run, version, z } from '@liche/core'

type BookmarkRow = {
  id: number
  url: string
  title: string | null
  tags: string | null
}

const bookmark = z.object({
  id: z.number(),
  tags: z.array(z.string()),
  title: z.string().nullable(),
  url: z.string(),
})

// Every command declares the same env input, so `run(cli, argv, { env })` is the
// only thing that decides which database file is touched. Nothing reads Bun.env.
const dbEnv = z.object({
  BOOKMARKS_DB: z.string(),
})

// `ctx.var` is an untyped string-keyed bag — RunContext fixes its vars slot to
// Record<string, unknown>, so the z.custom<Database>() in the vars schema only
// validates at runtime and never types this access. The middleware guarantees the
// handle is present for any command that declares BOOKMARKS_DB; this single
// checked read recovers the `Database` type and fails loudly if the invariant is
// ever broken, instead of scattering unchecked casts across the handlers.
function database(ctx: { var: Record<string, unknown> }): Database {
  const db = ctx.var['db']
  if (!(db instanceof Database)) {
    throw new Error('bookmarks: database handle missing from run context')
  }
  return db
}

function toBookmark(row: BookmarkRow): z.infer<typeof bookmark> {
  return {
    id: row.id,
    tags: row.tags ? row.tags.split(',') : [],
    title: row.title,
    url: row.url,
  }
}

export const cli = defineCli({
  // The middleware owns the only mutable resource in this example: a real
  // `Database` handle. It opens the file named by ctx.env.BOOKMARKS_DB, applies
  // the schema migration, stashes the handle on ctx.var.db, and — crucially —
  // closes it in `finally` so every invocation cleans up after itself. Command
  // handlers never open or close the connection; they just read ctx.var.db.
  middleware: [middleware(async (ctx, next) => {
    const path = ctx.env['BOOKMARKS_DB']
    // Help, version, and reflection commands don't declare BOOKMARKS_DB, so the
    // resource is only acquired for commands that actually need it.
    if (typeof path !== 'string' || path.length === 0) {
      await next()
      return
    }
    const db = new Database(path)
    try {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec(`
        CREATE TABLE IF NOT EXISTS bookmarks (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          url   TEXT NOT NULL UNIQUE,
          title TEXT,
          tags  TEXT
        )
      `)
      ctx.set('db', db)
      await next()
    } finally {
      db.close()
    }
  })],
  extensions: [help(), version(), outputControls(), reflectionControls()],
  commands: [
    defineCommand({
      path: ['add'],
      input: {
        args: z.object({
          url: z.string(),
        }),
        env: dbEnv,
        options: z.object({
          tags: z.string().optional(),
          title: z.string().optional(),
        }),
      },
      output: bookmark,
      run({ ctx, input }) {
        const db = database(ctx)
        const tags = input.options.tags
          ? input.options.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : []
        try {
          const info = db
            .query('INSERT INTO bookmarks (url, title, tags) VALUES (?, ?, ?)')
            .run(input.args.url, input.options.title ?? null, tags.join(',') || null)
          return {
            id: Number(info.lastInsertRowid),
            tags,
            title: input.options.title ?? null,
            url: input.args.url,
          }
        } catch (error) {
          if (error instanceof Error && (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return fail({
              code: 'bookmark.duplicate',
              message: `A bookmark already exists for ${input.args.url}`,
            })
          }
          throw error
        }
      },
    }),
    defineCommand({
      path: ['list'],
      input: {
        env: dbEnv,
        options: z.object({
          tag: z.string().optional(),
        }),
      },
      output: z.object({
        bookmarks: z.array(bookmark),
      }),
      run({ ctx, input }) {
        const rows = database(ctx)
          .query('SELECT id, url, title, tags FROM bookmarks ORDER BY id')
          .all() as BookmarkRow[]
        const bookmarks = rows.map(toBookmark)
        const tag = input.options.tag
        return {
          bookmarks: tag ? bookmarks.filter((entry) => entry.tags.includes(tag)) : bookmarks,
        }
      },
    }),
    defineCommand({
      path: ['remove'],
      input: {
        args: z.object({
          id: z.coerce.number().int().positive(),
        }),
        env: dbEnv,
      },
      output: z.object({
        removed: z.number(),
      }),
      run({ ctx, input }) {
        const info = database(ctx).query('DELETE FROM bookmarks WHERE id = ?').run(input.args.id)
        if (info.changes === 0) {
          return fail({
            code: 'bookmark.not_found',
            message: `No bookmark with id ${input.args.id}`,
          })
        }
        return { removed: input.args.id }
      },
    }),
  ],
  description: 'Bookmarks CLI backed by bun:sqlite.',
  name: 'bookmarks',
  // The handle lives in run-context state. It starts undefined, is set by the
  // middleware, and is read by handlers via database() — never part of any
  // command's declared input. This schema is validated at runtime only; the vars
  // slot is untyped at the ctx.var boundary (see database() above).
  vars: z.object({
    db: z.custom<Database>().optional(),
  }),
  version: '0.1.0',
})

if (import.meta.main) await run(cli, process.argv.slice(2))
