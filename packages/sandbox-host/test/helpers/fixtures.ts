/**
 * Test Fixtures
 *
 * Sample projects for testing sandbox-host.
 */

import type { Vfs } from '@pubwiki/vfs'
import type { ProjectConfig } from '@pubwiki/bundler'

/**
 * Create a simple TypeScript/React project
 */
export async function createSimpleProject(vfs: Vfs): Promise<ProjectConfig> {
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

  await vfs.createFile('/project/index.html', `
<!DOCTYPE html>
<html>
<head>
  <title>Test App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`)

  return {
    isBuildable: true,
    tsconfigPath: '/project/tsconfig.json',
    projectRoot: '/project',
    entryFiles: ['/project/src/main.tsx'],
    tsconfigContent: {
      compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx' },
      files: ['src/main.tsx']
    }
  }
}

/**
 * Create a project with multiple files
 */
export async function createMultiFileProject(vfs: Vfs): Promise<ProjectConfig> {
  await vfs.createFile('/multi/tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      jsx: 'react-jsx'
    },
    files: ['src/app.tsx']
  }, null, 2))

  await vfs.createFile('/multi/src/app.tsx', `
import React from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'

export function App() {
  return (
    <div>
      <Header />
      <main>Content</main>
      <Footer />
    </div>
  )
}
`)

  await vfs.createFile('/multi/src/components/Header.tsx', `
import React from 'react'

export function Header() {
  return <header>Header</header>
}
`)

  await vfs.createFile('/multi/src/components/Footer.tsx', `
import React from 'react'

export function Footer() {
  return <footer>Footer</footer>
}
`)

  await vfs.createFile('/multi/index.html', `
<!DOCTYPE html>
<html>
<head>
  <title>Multi-file App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/app.tsx"></script>
</body>
</html>
`)

  return {
    isBuildable: true,
    tsconfigPath: '/multi/tsconfig.json',
    projectRoot: '/multi',
    entryFiles: ['/multi/src/app.tsx'],
    tsconfigContent: {
      compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx' },
      files: ['src/app.tsx']
    }
  }
}

/**
 * Create a static HTML project (no bundling needed)
 */
export async function createStaticProject(vfs: Vfs): Promise<ProjectConfig> {
  await vfs.createFile('/static/index.html', `
<!DOCTYPE html>
<html>
<head>
  <title>Static Page</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <h1>Hello World</h1>
  <script src="/script.js"></script>
</body>
</html>
`)

  await vfs.createFile('/static/styles.css', `
body {
  font-family: sans-serif;
  margin: 0;
  padding: 20px;
}

h1 {
  color: #333;
}
`)

  await vfs.createFile('/static/script.js', `
console.log('Hello from static script!')
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready')
})
`)

  return {
    isBuildable: false,
    tsconfigPath: '',
    projectRoot: '/static',
    entryFiles: [],
    tsconfigContent: null
  }
}

/**
 * Create an empty project config for non-buildable scenarios
 */
export function createNonBuildableConfig(): ProjectConfig {
  return {
    isBuildable: false,
    tsconfigPath: '',
    projectRoot: '/',
    entryFiles: [],
    tsconfigContent: null
  }
}
