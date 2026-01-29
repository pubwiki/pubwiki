/**
 * VSCode Link Service
 * 
 * Manages WebSocket connection between VFS and VS Code using @vfs/browser-client
 */

import { VfsBrowserClient, type VfsConnectionOptions } from '@pubwiki/vscode-bridge';
import type { VersionedVfs } from './store';

// ============================================================================
// Types
// ============================================================================

export type VSCodeLinkStatus = 'disconnected' | 'connecting' | 'connected';

export interface VSCodeLinkState {
	status: VSCodeLinkStatus;
	error: string | null;
}

export interface VSCodeLink {
	readonly state: VSCodeLinkState;
	connect(callbackUrl: string): Promise<void>;
	disconnect(): void;
}

// ============================================================================
// Implementation
// ============================================================================

class VSCodeLinkImpl implements VSCodeLink {
	private client: VfsBrowserClient | null = null;
	private _state = $state<VSCodeLinkState>({ status: 'disconnected', error: null });

	constructor(private vfs: VersionedVfs) {}

	get state(): VSCodeLinkState {
		return this._state;
	}

	async connect(callbackUrl: string): Promise<void> {
		// Disconnect any existing connection
		this.disconnect();

		this._state = { status: 'connecting', error: null };

		try {
			// Parse the callback URL
			let options: VfsConnectionOptions;
			try {
				options = VfsBrowserClient.parseCallbackUrl(callbackUrl);
			} catch (err) {
				throw new Error('Invalid callback URL format');
			}

			// Create the client
			// Note: VfsBrowserClient expects a Vfs instance, but our VersionedVfs
			// wraps a Vfs internally. We need to access the underlying vfs.
			// For now, we'll cast it - the interface should be compatible.
			this.client = new VfsBrowserClient(this.vfs as any);

			// Set up event handlers
			this.client.onDisconnect(() => {
				this._state = { status: 'disconnected', error: null };
			});

			this.client.onReconnect(() => {
				this._state = { status: 'connected', error: null };
			});

			// Connect with auto-reconnect
			await this.client.connect({
				...options,
				maxRetries: 5,
				retryDelay: 1000,
			});

			this._state = { status: 'connected', error: null };
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Connection failed';
			this._state = { status: 'disconnected', error: errorMessage };
			this.client = null;
			throw err;
		}
	}

	disconnect(): void {
		if (this.client) {
			this.client.disconnect();
			this.client = null;
		}
		this._state = { status: 'disconnected', error: null };
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a VSCode link manager for a VFS instance.
 * The link allows VS Code to remotely edit files in the VFS.
 */
export function createVSCodeLink(vfs: VersionedVfs): VSCodeLink {
	return new VSCodeLinkImpl(vfs);
}
