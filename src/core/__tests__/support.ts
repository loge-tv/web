import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlexClientInfo } from '../plexAccount'

const here = dirname(fileURLToPath(import.meta.url))

/** Fixtures copied from the Apple app's tests. */
export function fixture(name: string): string {
  return readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8')
}

export function fixtureJSON(name: string): unknown {
  return JSON.parse(fixture(name))
}

export interface RecordedRequest {
  url: URL
  method: string
  headers: Headers
  body?: string
  keepalive?: boolean
  credentials?: RequestCredentials
}

/** fetch returning canned responses by URL path; records requests. */
export class MockFetch {
  private stubs = new Map<string, { status: number; body: string }>()
  private failing = new Set<string>()
  requests: RecordedRequest[] = []

  stub(path: string, body: string, status = 200) {
    this.stubs.set(path, { status, body })
  }

  fail(path: string) {
    this.failing.add(path)
  }

  get last(): RecordedRequest {
    return this.requests[this.requests.length - 1]
  }

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input)
    // Plex paths like "/:/timeline" are kept as written.
    const path = decodeURIComponent(url.pathname)
    this.requests.push({
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
      keepalive: init.keepalive,
      credentials: init.credentials,
    })
    if (this.failing.has(path)) throw new TypeError('Failed to fetch')
    const stub = this.stubs.get(path) ?? { status: 404, body: '' }
    return new Response(stub.status === 204 ? null : stub.body, { status: stub.status })
  }
}

/** Answers 200 only for the given hosts. */
export function hostFetch(reachable: string[]) {
  return async (input: string): Promise<Response> => {
    const host = new URL(input).hostname
    if (!reachable.includes(host)) throw new TypeError('timed out')
    return new Response('{}', { status: 200 })
  }
}

export const testClient: PlexClientInfo = {
  clientIdentifier: 'test-client',
  product: 'Sepia TV',
  version: '1.0',
  platform: 'Chrome',
  platformVersion: '',
  device: 'Browser',
  deviceName: 'Sepia TV',
}
