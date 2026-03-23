import type { Page, ConsoleMessage } from '@playwright/test';

export class PlayerPage {
  readonly page: Page;
  private consoleLogs: string[] = [];

  constructor(page: Page) {
    this.page = page;
    // Capture console messages for build-cache verification and app log detection
    this.page.on('console', (msg: ConsoleMessage) => {
      this.consoleLogs.push(msg.text());
    });
  }

  /** Wait for the player to fully load (PlayLoader overlay disappears, iframe visible and active) */
  async waitForReady(timeout = 60_000) {
    // Wait for either "ready" (iframe active) or "error" (Failed to Load shown)
    const failedToLoad = this.page.getByText('Failed to Load');
    const iframe = this.page.locator('iframe');

    // Poll until we reach a terminal state (ready or error)
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // Check for error state first
      if (await failedToLoad.isVisible().catch(() => false)) {
        const errorMsg = await this.page.locator('p.text-gray-400').textContent().catch(() => 'unknown');
        throw new Error(`Player entered error state: "${errorMsg}"`);
      }

      // Check if iframe is ready (opacity-0 removed)
      const cls = await iframe.getAttribute('class').catch(() => '');
      if (cls && !cls.includes('opacity-0')) {
        // Iframe is active — player is ready
        return;
      }

      await this.page.waitForTimeout(500);
    }

    // Timed out — gather debug info
    const allLogs = this.consoleLogs.join('\n');
    throw new Error(
      `Player did not become ready within ${timeout}ms.\n` +
      `Console logs:\n${allLogs}`
    );
  }

  /**
   * Wait for the sandbox app to produce at least one console log,
   * meaning the app inside the iframe has started running.
   */
  async waitForAppLog(timeout = 30_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // Sandbox app logs are forwarded via HmrServiceImpl and appear as:
      // "[HmrServiceImpl] Log received: [level] message"
      const appLogs = this.consoleLogs.filter(l => l.includes('[HmrServiceImpl] Log received:'));
      if (appLogs.length > 0) return;
      await this.page.waitForTimeout(200);
    }
    throw new Error(
      `No sandbox app console logs received within ${timeout}ms.\n` +
      `All captured logs:\n${this.consoleLogs.join('\n')}`
    );
  }

  /** Check if an error occurred during loading */
  async hasError(): Promise<boolean> {
    return this.page.locator('text=error').isVisible();
  }

  /** Assert that the remote build cache (L2) was used and no local compilation (L3) occurred */
  assertBuildCacheUsed() {
    const l2Hits = this.consoleLogs.filter(l => l.includes('[BuildAwareVfs] L2 (remote) hit'));
    const l3Fallbacks = this.consoleLogs.filter(l => l.includes('[BuildAwareVfs] L3 (compile) fallback'));

    if (l2Hits.length === 0) {
      throw new Error(
        'Expected at least one L2 (remote) build cache hit, but found none.\n' +
        `Relevant logs:\n${this.consoleLogs.filter(l => l.includes('[BuildAwareVfs]')).join('\n')}`
      );
    }

    if (l3Fallbacks.length > 0) {
      throw new Error(
        `Expected no L3 (compile) fallbacks, but found ${l3Fallbacks.length}:\n` +
        l3Fallbacks.join('\n')
      );
    }
  }
}
