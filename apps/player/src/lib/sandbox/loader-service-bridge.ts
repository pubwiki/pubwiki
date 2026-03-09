/**
 * Loader Service Bridge for Player
 *
 * Adapts flow-core LoaderBackend services to @pubwiki/sandbox-host's
 * ICustomService + CustomServiceFactory for sandbox RPC integration.
 */

import { RpcTarget, isStreamingService } from '@pubwiki/sandbox-host';
import type { ICustomService, ServiceDefinition } from '@pubwiki/sandbox-host';
import type { CustomServiceFactory, MainRpcHostConfig } from '@pubwiki/sandbox-host';
import {
	createLoaderInterface,
	type LoaderInterface,
	type LoaderBackend,
} from '@pubwiki/flow-core';

/**
 * Bridge that exposes a LoaderBackend service via RPC.
 *
 * Extends RpcTarget for capnweb serialization and implements
 * ICustomService for sandbox-host's custom service protocol.
 */
export class LoaderServiceBridge extends RpcTarget implements ICustomService {
	private loaderInterface: LoaderInterface;
	private serviceDef: ServiceDefinition;
	private _isStreaming: boolean;

	constructor(loaderInterface: LoaderInterface, serviceDef: ServiceDefinition) {
		super();
		this.loaderInterface = loaderInterface;
		this.serviceDef = serviceDef;
		this._isStreaming = isStreamingService(serviceDef);
	}

	get isStreaming(): boolean {
		return this._isStreaming;
	}

	get serviceIdentifier(): string {
		return this.serviceDef.identifier;
	}

	async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (this._isStreaming) {
			throw new Error(`Service ${this.serviceIdentifier} is streaming. Use stream() instead.`);
		}
		const result = await this.loaderInterface.callService(this.serviceIdentifier, inputs);
		if (!result.success) throw new Error(result.error ?? 'Service call failed');
		return result.outputs ?? {};
	}

	async stream(
		inputs: Record<string, unknown>,
		on: (value: Record<string, unknown>) => Promise<void> | void
	): Promise<void> {
		if (!this._isStreaming) {
			throw new Error(`Service ${this.serviceIdentifier} is not streaming`);
		}
		await this.loaderInterface.streamService(this.serviceIdentifier, inputs, on as (value: unknown) => Promise<void> | void);
	}

	getDefinition(): ServiceDefinition {
		return this.serviceDef;
	}

	isReady(): boolean {
		return this.loaderInterface.isReady();
	}
}

/**
 * Create sandbox-host CustomServiceFactory instances from Player's loader backends.
 *
 * Each service registered in a LoaderBackend is exposed as a factory that
 * creates LoaderServiceBridge instances for the sandbox RPC channel.
 */
export async function createPlayerLoaderServices(
	backends: Map<string, LoaderBackend>
): Promise<Map<string, CustomServiceFactory<MainRpcHostConfig>>> {
	const services = new Map<string, CustomServiceFactory<MainRpcHostConfig>>();

	for (const [, backend] of backends) {
		if (!backend.isReady()) continue;

		const loaderInterface = createLoaderInterface(backend);

		let definitions: ServiceDefinition[];
		try {
			definitions = await loaderInterface.listServices() as ServiceDefinition[];
		} catch (e) {
			console.warn('[createPlayerLoaderServices] Failed to list services:', e);
			continue;
		}

		for (const serviceDef of definitions) {
			services.set(serviceDef.identifier, () => {
				return new LoaderServiceBridge(loaderInterface, serviceDef);
			});
		}
	}

	return services;
}
