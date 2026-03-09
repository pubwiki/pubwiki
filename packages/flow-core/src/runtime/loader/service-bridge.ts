/**
 * Service Bridge
 * 
 * Generic bridge that forwards service calls to a LoaderBackend.
 * 
 * This is a pure TypeScript class without RPC-framework coupling.
 * App layers (Studio, Player) extend or wrap it with their RPC target
 * implementation (e.g. capnweb's RpcTarget).
 */

import type {
	LoaderBackend,
	ServiceDefinition,
	RpcStreamCallback,
} from '../types';

/**
 * Bridge that exposes a single LoaderBackend service via a unified call/stream interface.
 * 
 * Studio wraps this with `RpcTarget extends ServiceBridge` to integrate with capnweb.
 * Player can use it directly or via its own RPC layer.
 */
export class ServiceBridge {
	private backend: LoaderBackend;
	private serviceDef: ServiceDefinition;
	private _isStreaming: boolean;

	constructor(backend: LoaderBackend, serviceDef: ServiceDefinition) {
		this.backend = backend;
		this.serviceDef = serviceDef;
		this._isStreaming = serviceDef.isIterator ?? false;
	}

	get isStreaming(): boolean {
		return this._isStreaming;
	}

	get serviceIdentifier(): string {
		return this.serviceDef.identifier;
	}

	async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (this._isStreaming) {
			throw new Error(
				`Service ${this.serviceIdentifier} is a streaming service. Use stream() instead.`,
			);
		}
		const result = await this.backend.callService(this.serviceIdentifier, inputs);
		if (!result.success) {
			throw new Error(result.error ?? 'Service call failed');
		}
		return result.outputs ?? {};
	}

	async stream(
		inputs: Record<string, unknown>,
		callback: RpcStreamCallback,
	): Promise<void> {
		if (!this._isStreaming) {
			throw new Error(
				`Service ${this.serviceIdentifier} is not a streaming service.`,
			);
		}
		await this.backend.streamService(this.serviceIdentifier, inputs, callback);
	}

	getDefinition(): ServiceDefinition {
		return this.serviceDef;
	}

	isReady(): boolean {
		return this.backend.isReady();
	}
}
