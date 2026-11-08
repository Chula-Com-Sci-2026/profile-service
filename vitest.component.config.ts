import { defineConfig } from 'vitest/config'

// Component tests: the built Docker image, run as a black box beside its own PostgreSQL, RabbitMQ
// and MinIO, which tests/component/setup.ts starts through Testcontainers. Serial, because the
// files share one stack and the outage scenario stops its broker. Long timeouts: the first run
// builds the image.
export default defineConfig({
  test: {
    include: ['tests/component/**/*.test.ts'],
    globalSetup: ['tests/component/setup.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
})
