/**
 * Test Fixtures
 *
 * Sample projects for testing the bundler.
 */

import type { Vfs } from '@pubwiki/vfs'

/**
 * Create a simple single-file project
 */
export async function createSimpleProject(vfs: Vfs): Promise<void> {
  await vfs.createFile('/project/tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      jsx: 'react-jsx'
    },
    files: ['src/main.tsx']
  }, null, 2))

  await vfs.createFile('/project/src/main.tsx', `
import React from 'react'

export function App() {
  return <div>Hello World</div>
}

export default App
`)
}

/**
 * Create a project with multiple entry files
 */
export async function createMultiEntryProject(vfs: Vfs): Promise<void> {
  await vfs.createFile('/multi-entry/tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      jsx: 'react-jsx'
    },
    files: ['src/app.tsx', 'src/worker.ts']
  }, null, 2))

  await vfs.createFile('/multi-entry/src/app.tsx', `
import React from 'react'
import { formatDate } from './utils/date'

export function App() {
  return <div>Date: {formatDate(new Date())}</div>
}
`)

  await vfs.createFile('/multi-entry/src/worker.ts', `
import { processData } from './utils/data'

self.onmessage = (e) => {
  const result = processData(e.data)
  self.postMessage(result)
}
`)

  await vfs.createFile('/multi-entry/src/utils/date.ts', `
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
`)

  await vfs.createFile('/multi-entry/src/utils/data.ts', `
export function processData(data: unknown): unknown {
  return { processed: true, data }
}
`)
}

/**
 * Create a project with complex dependency graph
 *
 * Dependency structure:
 * 
 * main.tsx
 *   ├── components/App.tsx
 *   │     ├── components/Header.tsx
 *   │     │     └── utils/config.ts
 *   │     ├── components/Content.tsx
 *   │     │     ├── hooks/useData.ts
 *   │     │     │     └── utils/api.ts
 *   │     │     │           └── utils/config.ts (shared)
 *   │     │     └── components/Card.tsx
 *   │     │           └── styles/card.css
 *   │     └── components/Footer.tsx
 *   │           └── utils/config.ts (shared)
 *   └── utils/logger.ts
 *         └── utils/config.ts (shared)
 */
export async function createComplexDependencyProject(vfs: Vfs): Promise<void> {
  await vfs.createFile('/complex/tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      jsx: 'react-jsx',
      strict: true
    },
    files: ['src/main.tsx']
  }, null, 2))

  // Main entry
  await vfs.createFile('/complex/src/main.tsx', `
import React from 'react'
import { App } from './components/App'
import { logger } from './utils/logger'

logger.info('Application starting')

export function render() {
  return <App />
}
`)

  // Components
  await vfs.createFile('/complex/src/components/App.tsx', `
import React from 'react'
import { Header } from './Header'
import { Content } from './Content'
import { Footer } from './Footer'

export function App() {
  return (
    <div className="app">
      <Header />
      <Content />
      <Footer />
    </div>
  )
}
`)

  await vfs.createFile('/complex/src/components/Header.tsx', `
import React from 'react'
import { config } from '../utils/config'

export function Header() {
  return (
    <header>
      <h1>{config.appName}</h1>
      <span>v{config.version}</span>
    </header>
  )
}
`)

  await vfs.createFile('/complex/src/components/Content.tsx', `
import React from 'react'
import { useData } from '../hooks/useData'
import { Card } from './Card'

export function Content() {
  const { data, loading } = useData()
  
  if (loading) return <div>Loading...</div>
  
  return (
    <main>
      {data.map((item, index) => (
        <Card key={index} title={item.title} content={item.content} />
      ))}
    </main>
  )
}
`)

  await vfs.createFile('/complex/src/components/Card.tsx', `
import React from 'react'
import '../styles/card.css'

interface CardProps {
  title: string
  content: string
}

export function Card({ title, content }: CardProps) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p>{content}</p>
    </div>
  )
}
`)

  await vfs.createFile('/complex/src/components/Footer.tsx', `
import React from 'react'
import { config } from '../utils/config'

export function Footer() {
  return (
    <footer>
      <p>&copy; {new Date().getFullYear()} {config.appName}</p>
    </footer>
  )
}
`)

  // Hooks
  await vfs.createFile('/complex/src/hooks/useData.ts', `
import { useState, useEffect } from 'react'
import { fetchData } from '../utils/api'

interface DataItem {
  title: string
  content: string
}

export function useData() {
  const [data, setData] = useState<DataItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData().then(result => {
      setData(result)
      setLoading(false)
    })
  }, [])

  return { data, loading }
}
`)

  // Utils
  await vfs.createFile('/complex/src/utils/config.ts', `
export const config = {
  appName: 'Test App',
  version: '1.0.0',
  apiUrl: 'https://api.example.com'
}
`)

  await vfs.createFile('/complex/src/utils/api.ts', `
import { config } from './config'

export async function fetchData() {
  // Simulated API call
  console.log('Fetching from:', config.apiUrl)
  return [
    { title: 'Item 1', content: 'Content 1' },
    { title: 'Item 2', content: 'Content 2' }
  ]
}
`)

  await vfs.createFile('/complex/src/utils/logger.ts', `
import { config } from './config'

export const logger = {
  info: (msg: string) => console.log(\`[\${config.appName}] INFO: \${msg}\`),
  warn: (msg: string) => console.warn(\`[\${config.appName}] WARN: \${msg}\`),
  error: (msg: string) => console.error(\`[\${config.appName}] ERROR: \${msg}\`)
}
`)

  // Styles
  await vfs.createFile('/complex/src/styles/card.css', `
.card {
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 16px;
  margin: 8px 0;
}

.card h3 {
  margin: 0 0 8px 0;
  color: #333;
}

.card p {
  margin: 0;
  color: #666;
}
`)
}

/**
 * Create a project with circular dependency (should be handled gracefully)
 */
export async function createCircularDependencyProject(vfs: Vfs): Promise<void> {
  await vfs.createFile('/circular/tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext'
    },
    files: ['src/main.ts']
  }, null, 2))

  await vfs.createFile('/circular/src/main.ts', `
import { moduleA } from './moduleA'

console.log(moduleA.name)
`)

  // moduleA imports moduleB, moduleB imports moduleA
  await vfs.createFile('/circular/src/moduleA.ts', `
import { moduleB } from './moduleB'

export const moduleA = {
  name: 'Module A',
  dependency: moduleB
}
`)

  await vfs.createFile('/circular/src/moduleB.ts', `
import { moduleA } from './moduleA'

export const moduleB = {
  name: 'Module B',
  dependency: moduleA
}
`)
}

/**
 * Create a project with index file imports
 */
export async function createIndexImportProject(vfs: Vfs): Promise<void> {
  await vfs.createFile('/index-imports/tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      jsx: 'react-jsx'
    },
    files: ['src/main.tsx']
  }, null, 2))

  await vfs.createFile('/index-imports/src/main.tsx', `
import React from 'react'
import { Button, Input, Select } from './components'
import { formatDate, formatNumber } from './utils'

export function App() {
  return (
    <div>
      <Button label="Click me" />
      <Input placeholder="Enter text" />
      <Select options={['A', 'B', 'C']} />
      <p>Date: {formatDate(new Date())}</p>
      <p>Number: {formatNumber(12345.67)}</p>
    </div>
  )
}
`)

  // Components index
  await vfs.createFile('/index-imports/src/components/index.ts', `
export { Button } from './Button'
export { Input } from './Input'
export { Select } from './Select'
`)

  await vfs.createFile('/index-imports/src/components/Button.tsx', `
import React from 'react'

interface ButtonProps {
  label: string
  onClick?: () => void
}

export function Button({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>
}
`)

  await vfs.createFile('/index-imports/src/components/Input.tsx', `
import React from 'react'

interface InputProps {
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
}

export function Input({ placeholder, value, onChange }: InputProps) {
  return (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}
`)

  await vfs.createFile('/index-imports/src/components/Select.tsx', `
import React from 'react'

interface SelectProps {
  options: string[]
  value?: string
  onChange?: (value: string) => void
}

export function Select({ options, value, onChange }: SelectProps) {
  return (
    <select value={value} onChange={(e) => onChange?.(e.target.value)}>
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  )
}
`)

  // Utils index
  await vfs.createFile('/index-imports/src/utils/index.ts', `
export { formatDate } from './date'
export { formatNumber } from './number'
`)

  await vfs.createFile('/index-imports/src/utils/date.ts', `
export function formatDate(date: Date): string {
  return date.toLocaleDateString()
}
`)

  await vfs.createFile('/index-imports/src/utils/number.ts', `
export function formatNumber(num: number): string {
  return num.toLocaleString()
}
`)
}

/**
 * Create a project with tsconfig that has comments
 */
export async function createTsconfigWithCommentsProject(vfs: Vfs): Promise<void> {
  await vfs.createFile('/tsconfig-comments/tsconfig.json', `{
  // Compiler options
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    /* JSX support */
    "jsx": "react-jsx"
  },
  // Entry files
  "files": [
    "src/main.ts" // Main entry point
  ]
}`)

  await vfs.createFile('/tsconfig-comments/src/main.ts', `
export function main() {
  console.log('Hello from main')
}
`)
}

/**
 * Create a project with build error
 */
export async function createProjectWithError(vfs: Vfs): Promise<void> {
  await vfs.createFile('/error-project/tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext'
    },
    files: ['src/main.ts']
  }, null, 2))

  await vfs.createFile('/error-project/src/main.ts', `
import { nonExistent } from './missing-module'

console.log(nonExistent)
`)
}
