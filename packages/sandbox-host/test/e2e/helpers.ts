/**
 * E2E Test Helpers Index
 * 
 * Helpers specifically for browser-based e2e tests.
 */

export { createTestVfs, addFile, updateFile, deleteFile, readFileContent } from '../helpers/test-vfs'
export { MockMessagePort, MockMessageChannel } from '../helpers/mock-message-channel'
export { createMockIframe, type MockIframe, type MockContentWindow, type StoredMessage } from '../helpers/mock-iframe'
export * from '../helpers/fixtures'

/**
 * Create a real iframe element for e2e tests
 */
export function createRealIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.sandbox.add('allow-scripts', 'allow-same-origin')
  document.body.appendChild(iframe)
  return iframe
}

/**
 * Remove an iframe from the DOM
 */
export function removeIframe(iframe: HTMLIFrameElement): void {
  if (iframe.parentNode) {
    iframe.parentNode.removeChild(iframe)
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  throw new Error(`Condition not met within ${timeout}ms`)
}

/**
 * Create a simple HTML page content for sandbox iframe
 */
export function createSandboxHtml(scripts: string[] = []): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sandbox</title>
</head>
<body>
  <div id="root"></div>
  ${scripts.map(src => `<script type="module" src="${src}"></script>`).join('\n')}
</body>
</html>
`
}
