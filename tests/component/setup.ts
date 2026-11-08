import type { TestProject } from 'vitest/node'
import { type StackAccess, startStack } from './stack.ts'

/**
 * The component suite's world, built once per run: the image from this checkout, and the stack
 * around it. Every test file reaches it only through what is provided here — addresses, never
 * objects — and from there only through the service's public interfaces.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let stack: Awaited<ReturnType<typeof startStack>>
  try {
    stack = await startStack()
  } catch (error) {
    // Vitest 5 prints an error thrown from a globalSetup as its own "code.charCodeAt is not a
    // function", and the real one never appears — so it is said here, before it is rethrown.
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`\nthe component stack did not start: ${reason}\n`)
    throw error
  }
  project.provide('component', stack.access)
  return stack.stop
}

declare module 'vitest' {
  interface ProvidedContext {
    component: StackAccess
  }
}
