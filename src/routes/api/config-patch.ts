import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import YAML from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'

const HERMES_HOME = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')
const CONFIG_PATH = path.join(HERMES_HOME, 'config.yaml')

function readConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = YAML.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(HERMES_HOME, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, YAML.stringify(config), 'utf-8')
}

// Convert a dotted path + value into a nested patch object.
// e.g. ("model.default", "gpt-4") => { model: { default: "gpt-4" } }
function buildNestedPatch(dotPath: string, value: unknown): Record<string, unknown> {
  const keys = dotPath.split('.')
  const result: Record<string, unknown> = {}
  let cursor: Record<string, unknown> = result
  for (let i = 0; i < keys.length - 1; i++) {
    cursor[keys[i]] = {}
    cursor = cursor[keys[i]] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
  return result
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      deepMerge(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      target[key] = value
    }
  }
}

export const Route = createFileRoute('/api/config-patch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = isAuthenticated(request)
        if (authResult !== true) return authResult as Response
        let body: { path?: string; value?: unknown }
        try {
          body = await request.json()
        } catch {
          return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }
        if (typeof body.path !== 'string' || body.path.trim() === '') {
          return Response.json({ ok: false, error: 'Missing or invalid "path" field' }, { status: 400 })
        }
        const patch = buildNestedPatch(body.path, body.value)
        const current = readConfig()
        deepMerge(current, patch)
        writeConfig(current)
        return Response.json({ ok: true })
      },
    },
  },
})
