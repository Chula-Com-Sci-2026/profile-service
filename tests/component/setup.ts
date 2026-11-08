import type { TestProject } from 'vitest/node'
import { type StackAccess, startStack } from './stack.ts'

/**
 * The component suite's world, built once per run: the image from this checkout, and the stack
 * around it. Every test file reaches it only through what is provided here — addresses, never
 * objects — and from there only through the service's public interfaces.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { access, stop } = await startStack()
  project.provide('component', access)
  return stop
}

declare module 'vitest' {
  interface ProvidedContext {
    component: StackAccess
  }
}
