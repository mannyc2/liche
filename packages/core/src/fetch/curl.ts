import type { FetchEntry, Result } from '../types.js'

export async function callFetch(entry: FetchEntry, args: string[]): Promise<Result> {
  const { body, headers, method, path } = parseCurl(args)
  const joinedPath = [entry.basePath, ...path]
    .filter(Boolean)
    .map((segment) => String(segment).replace(/^\/+|\/+$/g, ''))
    .join('/')
  const requestInit: RequestInit = body === undefined ? { headers, method } : { body, headers, method }
  const response = await entry.fetch(new Request(`http://lili.local/${joinedPath}`, requestInit))
  const data = await responseData(response)

  if (response.ok) return { ok: true, data, error: null }
  return {
    ok: false,
    data: null,
    error: {
      code: 'FETCH_ERROR',
      message: typeof data === 'string' ? data : JSON.stringify(data),
      status: response.status,
    },
  }
}

export function parseCurl(args: string[]) {
  let method = 'GET'
  let body: BodyInit | undefined
  const headers = new Headers()
  const path: string[] = []

  for (let index = 0; index < args.length; index++) {
    const token = args[index]!
    if (token === '-X' || token === '--request' || token === '--method') method = args[++index]!.toUpperCase()
    else if (token === '-d' || token === '--data' || token === '--body') {
      method = method === 'GET' ? 'POST' : method
      body = args[++index]
      headers.set('Content-Type', 'application/json')
    } else if (token === '-H' || token === '--header') {
      const [name, ...value] = args[++index]!.split(':')
      headers.set(name!.trim(), value.join(':').trim())
    } else path.push(token)
  }

  return { body, headers, method, path }
}

export async function responseData(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('json') ? await response.json() : await response.text()
}
