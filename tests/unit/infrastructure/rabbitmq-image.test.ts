import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tag = (file: string, pattern: RegExp): string | undefined => readFileSync(file, 'utf8').match(pattern)?.[1]

const compose = tag('docker-compose.yml', /image:\s*rabbitmq:(\S+)/)
const integration = tag('tests/integration/setup.ts', /RABBITMQ_IMAGE = 'rabbitmq:([^']+)'/)
const component = tag('tests/component/stack.ts', /RABBITMQ_IMAGE = 'rabbitmq:([^']+)'/)

describe('the RabbitMQ image', () => {
  it('is the team’s image, rabbitmq:4.3.6-management', () => {
    expect(compose).toBe('4.3.6-management')
  })

  it('is the same for development and for the integration suite, which must move together', () => {
    expect(integration).toBe(compose)
  })

  it('is the same for the component suite, which runs the image beside it', () => {
    expect(component).toBe(compose)
  })
})
