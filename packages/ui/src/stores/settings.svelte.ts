import { setContext, getContext } from 'svelte';
import { persist } from '../utils';

const SETTINGS_KEY = Symbol('settings');

// Predefined API providers with their base URLs
export const API_PROVIDERS = {
	openai: {
		name: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1'
	},
	openrouter: {
		name: 'OpenRouter',
		baseUrl: 'https://openrouter.ai/api/v1'
	},
	anthropic: {
		name: 'Anthropic',
		baseUrl: 'https://api.anthropic.com/v1'
	},
	google: {
		name: 'Google AI',
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
	},
	custom: {
		name: 'Custom',
		baseUrl: ''
	}
} as const;

export type ApiProviderKey = keyof typeof API_PROVIDERS;

export interface ApiSettings {
	provider: ApiProviderKey;
	customBaseUrl: string;
	apiKey: string;
	selectedModel: string;
}

export interface UserSettings {
	api: ApiSettings;
	// Future settings can be added here
}

const DEFAULT_SETTINGS: UserSettings = {
	api: {
		provider: 'openai',
		customBaseUrl: '',
		apiKey: '',
		selectedModel: ''
	}
};

export class SettingsStore {
	private settings = persist<UserSettings>('user_settings', DEFAULT_SETTINGS);

	get api() {
		return this.settings.value.api;
	}

	get effectiveBaseUrl() {
		const api = this.api;
		if (api.provider === 'custom') {
			return api.customBaseUrl;
		}
		return API_PROVIDERS[api.provider].baseUrl;
	}

	updateApi(updates: Partial<ApiSettings>) {
		this.settings.value = {
			...this.settings.value,
			api: {
				...this.settings.value.api,
				...updates
			}
		};
	}

	setProvider(provider: ApiProviderKey) {
		this.updateApi({ provider, selectedModel: '' });
	}

	setApiKey(apiKey: string) {
		this.updateApi({ apiKey });
	}

	setCustomBaseUrl(customBaseUrl: string) {
		this.updateApi({ customBaseUrl });
	}

	setSelectedModel(selectedModel: string) {
		this.updateApi({ selectedModel });
	}

	// Fetch available models from the API
	async fetchModels(): Promise<string[]> {
		const baseUrl = this.effectiveBaseUrl;
		const apiKey = this.api.apiKey;

		if (!baseUrl || !apiKey) {
			return [];
		}

		try {
			const response = await fetch(`${baseUrl}/models`, {
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				console.error('Failed to fetch models:', response.status);
				return [];
			}

			const data = await response.json();
			// OpenAI-compatible API returns { data: [{ id: "model-name", ... }] }
			if (data.data && Array.isArray(data.data)) {
				return data.data.map((m: { id: string }) => m.id).sort();
			}
			return [];
		} catch (error) {
			console.error('Error fetching models:', error);
			return [];
		}
	}
}

export function createSettingsStore() {
	const store = new SettingsStore();
	setContext(SETTINGS_KEY, store);
	return store;
}

export function getSettingsStore(): SettingsStore {
	const store = getContext<SettingsStore>(SETTINGS_KEY);
	if (!store) {
		throw new Error('SettingsStore not found. Did you call createSettingsStore() in a parent component?');
	}
	return store;
}
