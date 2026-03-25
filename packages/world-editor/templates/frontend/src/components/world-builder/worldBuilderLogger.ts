/**
 * World Builder Logger
 *
 * Collects timestamped log entries throughout the World Builder pipeline.
 * Supports exporting logs as JSON for debugging.
 */

// ============================================================================
// Types
// ============================================================================

export interface WBLogEntry {
    timestamp: number
    category: 'user_input' | 'ai_response' | 'tool_call' | 'tool_result' | 'step_output' | 'error' | 'system'
    stepId?: string
    round?: number
    message: string
    data?: unknown
}

// ============================================================================
// Logger Singleton
// ============================================================================

const MAX_LOG_ENTRIES = 2000

class WorldBuilderLogger {
    private entries: WBLogEntry[] = []

    log(entry: Omit<WBLogEntry, 'timestamp'>): void {
        this.entries.push({
            ...entry,
            timestamp: Date.now(),
        })
        // Trim old entries
        if (this.entries.length > MAX_LOG_ENTRIES) {
            this.entries = this.entries.slice(-MAX_LOG_ENTRIES)
        }
        // Also log to console for development
        const prefix = `[WB:${entry.category}]`
        const stepInfo = entry.stepId ? ` [${entry.stepId}]` : ''
        const roundInfo = entry.round !== undefined ? ` R${entry.round}` : ''
        console.log(`${prefix}${stepInfo}${roundInfo} ${entry.message}`, entry.data !== undefined ? entry.data : '')
    }

    getEntries(): WBLogEntry[] {
        return [...this.entries]
    }

    clear(): void {
        this.entries = []
    }

    /**
     * Export all logs as a downloadable JSON file.
     */
    exportAsJSON(filename?: string): void {
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalEntries: this.entries.length,
            entries: this.entries.map(e => ({
                ...e,
                time: new Date(e.timestamp).toISOString(),
            })),
        }
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename || `wb-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }
}

/** Singleton instance */
export const wbLogger = new WorldBuilderLogger()
