export interface FullstackPlaywrightResult {
  status?: string
}

export interface FullstackPlaywrightTest {
  status?: string
  results?: FullstackPlaywrightResult[]
}

export interface FullstackPlaywrightSpec {
  title?: string
  file?: string
  ok?: boolean
  tests?: FullstackPlaywrightTest[]
}

export interface FullstackPlaywrightSuite {
  title?: string
  file?: string
  specs?: FullstackPlaywrightSpec[]
  suites?: FullstackPlaywrightSuite[]
}

export interface FullstackPlaywrightReport {
  config?: {
    updateSnapshots?: string
    rootDir?: string
    projects?: Array<{ testDir?: string }>
  }
  errors?: unknown[]
  suites?: FullstackPlaywrightSuite[]
  stats?: {
    expected?: number
    unexpected?: number
    flaky?: number
    skipped?: number
  }
}

export const REQUIRED_FULLSTACK_TESTS: Readonly<Record<string, readonly string[]>>

export function listFullstackSpecFiles(webRoot: string): string[]

export function auditFullstackSpecInventory(actualSpecs: readonly string[]): string[]

export function auditFullstackRun(report: FullstackPlaywrightReport, webRoot: string): string[]
