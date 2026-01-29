/**
 * Loader Service Bridge
 * 
 * Bridge class that exposes Loader node services (Lua VM) via RPC.
 * This creates a dynamic RpcTarget that forwards method calls to the Lua VM.
 * When a method is called, it maps to a service call in the Lua ServiceRegistry.
 */

import { RpcTarget, RpcStub, isStreamingService } from '@pubwiki/sandbox-host';
import type { ICustomService, ServiceDefinition, CustomServiceFactory, MainRpcHostConfig } from '@pubwiki/sandbox-host';
import { createLoaderInterface, type LoaderInterface } from '$components/nodes/loader/controller.svelte';

/**
 * Bridge class that exposes Loader services via RPC.
 * 
 * This creates a dynamic RpcTarget that forwards method calls to the Lua VM.
 * Implements ICustomService interface for unified service access.
 * 
 * For streaming services (iterator-based), use the stream() method with callback.
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

	/**
	 * Check if this is a streaming service
	 */
	get isStreaming(): boolean {
		return this._isStreaming;
	}

	/**
	 * Get the service identifier
	 */
	get serviceIdentifier(): string {
		return this.serviceDef.identifier;
	}

	/**
	 * Call the Loader service with given inputs.
	 * This is the main entry point for RPC calls (non-streaming).
	 * 
	 * @param inputs - Key-value map of inputs to pass to the service
	 * @returns The outputs from the service call
	 */
	async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (this._isStreaming) {
			throw new Error(`Service ${this.serviceIdentifier} is a streaming service. Use stream() method instead.`);
		}

		const result = await this.loaderInterface.callService(this.serviceIdentifier, inputs);
		if (!result.success) {
			throw new Error(result.error ?? 'Service call failed');
		}
		return result.outputs ?? {};
	}

	/**
	 * Call a streaming service with callback.
	 * 
	 * For services that return an iterator, this method iterates over all values
	 * and invokes the callback for each yielded value.
	 * 
	 * @param inputs - Input parameters for the service
	 * @param callback - RpcStub callback function for each yielded value
	 */
	async stream(
		inputs: Record<string, unknown>,
		callback: RpcStub<(value: unknown) => Promise<void> | void>
	): Promise<void> {
		if (!this._isStreaming) {
			throw new Error(`Service ${this.serviceIdentifier} is not a streaming service`);
		}
		
		await this.loaderInterface.streamService(
			this.serviceIdentifier,
			inputs,
			callback
		);
	}

	/**
	 * Get service definition with JSON Schema.
	 * Required by ICustomService interface.
	 */
	getDefinition(): ServiceDefinition {
		return this.serviceDef;
	}

	/**
	 * Check if the loader is still ready
	 */
	isReady(): boolean {
		return this.loaderInterface.isReady();
	}
}

/**
 * Create service factories from Loader node IDs.
 * 
 * Each service registered in a Loader's Lua ServiceRegistry is exposed via a LoaderServiceBridge.
 * The bridge forwards RPC calls to the actual Lua VM implementation.
 * 
 * @param loaderNodeIds - Array of Loader node IDs to create services from
 * @returns Map of service identifier to factory function
 */
export async function createLoaderServices(
	loaderNodeIds: string[]
): Promise<Map<string, CustomServiceFactory<MainRpcHostConfig>>> {
	const services = new Map<string, CustomServiceFactory<MainRpcHostConfig>>();

	for (const loaderId of loaderNodeIds) {
		const loaderInterface = createLoaderInterface(loaderId);
		
		// Skip loaders that aren't ready
		if (!loaderInterface.isReady()) continue;
		
		// Get registered services from the loader
		let serviceDefinitions: ServiceDefinition[];
		try {
			serviceDefinitions = await loaderInterface.listServices();
		} catch (e) {
			console.warn(`[createLoaderServices] Failed to list services for loader ${loaderId}:`, e);
			continue;
		}
		
		// For each registered service, create a factory
		for (const serviceDef of serviceDefinitions) {
			const serviceIdentifier = serviceDef.identifier;
			// Create factory that returns a LoaderServiceBridge
			services.set(serviceIdentifier, () => {
				return new LoaderServiceBridge(loaderInterface, serviceDef);
			});
			
			console.log(`[createLoaderServices] Registered Loader service: ${serviceIdentifier}`);
		}
	}

	return services;
}
