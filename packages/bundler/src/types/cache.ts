/**
 * Dependency entry for the dependency graph
 */
export interface DependencyEntry {
  path: string
  dependencies: string[]
  dependents: string[]
}
