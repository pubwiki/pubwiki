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

export type ModelRole = 'narrative' | 'recall' | 'updater' | 'designer';

export const MODEL_ROLES: { role: ModelRole; label: string; description: string }[] = [
	{ role: 'narrative', label: 'Narrative', description: 'Story generation & dialogue' },
	{ role: 'recall', label: 'Recall', description: 'Knowledge retrieval & queries' },
	{ role: 'updater', label: 'Updater', description: 'World state updates' },
	{ role: 'designer', label: 'Designer', description: 'Frontend code generation' },
];

export interface ModelRoleConfig {
	model: string;
	useCustomProvider: boolean;
	customBaseUrl: string;
	customApiKey: string;
}

// ============================================================================
// Model Presets
// ============================================================================

export interface ModelPreset {
	/** Unique identifier within its provider */
	id: string;
	/** Display name */
	name: string;
	/** Short description of use-case / optimization focus */
	description: string;
	/** Model assignments per role */
	roles: Record<ModelRole, string>;
}

export interface ProviderPresets {
	provider: ApiProviderKey;
	presets: ModelPreset[];
}

/**
 * Registry of recommended presets, keyed by provider.
 * Each provider can have multiple presets.
 */
export const MODEL_PRESETS: ProviderPresets[] = [
	{
		provider: 'openrouter',
		presets: [
			{
				id: 'openrouter-gemini-gpt',
				name: 'Gemini + GPT (Recommended)',
				description: 'Gemini 3.1 Pro for narrative, Flash Lite for recall/updater, GPT-5.4 Mini for designer',
				roles: {
					narrative: 'google/gemini-3.1-pro-preview',
					recall: 'google/gemini-3.1-flash-lite-preview',
					updater: 'google/gemini-3.1-flash-lite-preview',
					designer: 'openai/gpt-5.4-mini',
				},
			},
		],
	},
];

/**
 * Get available presets for a given provider.
 */
export function getPresetsForProvider(provider: ApiProviderKey): ModelPreset[] {
	return MODEL_PRESETS.find(p => p.provider === provider)?.presets ?? [];
}

export interface ApiSettings {
	provider: ApiProviderKey;
	customBaseUrl: string;
	apiKey: string;
	modelRoles: Record<ModelRole, ModelRoleConfig>;
}

export interface PrivacySettings {
	errorReporting: boolean;
}

export interface UserSettings {
	api: ApiSettings;
	privacy: PrivacySettings;
}

const DEFAULT_MODEL_ROLE_CONFIG: ModelRoleConfig = {
	model: '',
	useCustomProvider: false,
	customBaseUrl: '',
	customApiKey: '',
};

const DEFAULT_SETTINGS: UserSettings = {
	api: {
		provider: 'openai',
		customBaseUrl: '',
		apiKey: '',
		modelRoles: {
			narrative: { ...DEFAULT_MODEL_ROLE_CONFIG },
			recall: { ...DEFAULT_MODEL_ROLE_CONFIG },
			updater: { ...DEFAULT_MODEL_ROLE_CONFIG },
			designer: { ...DEFAULT_MODEL_ROLE_CONFIG },
		},
	},
	privacy: {
		errorReporting: false
	}
};

export class SettingsStore {
	private settings = persist<UserSettings>('user_settings', DEFAULT_SETTINGS);

	get api() {
		const raw = this.settings.value.api;
		// Ensure modelRoles always exists (migration from old format)
		if (!raw.modelRoles) {
			return { ...raw, modelRoles: DEFAULT_SETTINGS.api.modelRoles };
		}
		return raw;
	}

	get privacy(): PrivacySettings {
		return this.settings.value.privacy ?? DEFAULT_SETTINGS.privacy;
	}

	get effectiveBaseUrl() {
		const api = this.api;
		if (api.provider === 'custom') {
			return api.customBaseUrl;
		}
		return API_PROVIDERS[api.provider].baseUrl;
	}

	getLLMConfigForRole(role: ModelRole): { apiKey: string; model: string; baseUrl: string } {
		const roleConfig = this.api.modelRoles[role];
		if (roleConfig?.useCustomProvider) {
			return {
				apiKey: roleConfig.customApiKey,
				model: roleConfig.model,
				baseUrl: roleConfig.customBaseUrl,
			};
		}
		return {
			apiKey: this.api.apiKey,
			model: roleConfig?.model ?? '',
			baseUrl: this.effectiveBaseUrl,
		};
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
		this.updateApi({ provider });
	}

	setApiKey(apiKey: string) {
		this.updateApi({ apiKey });
	}

	setCustomBaseUrl(customBaseUrl: string) {
		this.updateApi({ customBaseUrl });
	}

	setModelRole(role: ModelRole, config: Partial<ModelRoleConfig>) {
		const current = this.settings.value;
		const currentRoles = current.api.modelRoles ?? DEFAULT_SETTINGS.api.modelRoles;
		this.settings.value = {
			...current,
			api: {
				...current.api,
				modelRoles: {
					...currentRoles,
					[role]: { ...currentRoles[role], ...config },
				},
			},
		};
	}

	/**
	 * Apply a model preset — sets the model for each role and clears
	 * independent-provider overrides so all roles use the global provider.
	 */
	applyPreset(preset: ModelPreset) {
		const current = this.settings.value;
		const currentRoles = current.api.modelRoles ?? DEFAULT_SETTINGS.api.modelRoles;
		const newRoles = { ...currentRoles };
		for (const role of Object.keys(preset.roles) as ModelRole[]) {
			newRoles[role] = {
				...currentRoles[role],
				model: preset.roles[role],
				useCustomProvider: false,
				customBaseUrl: '',
				customApiKey: '',
			};
		}
		this.settings.value = {
			...current,
			api: { ...current.api, modelRoles: newRoles },
		};
	}

	setErrorReporting(enabled: boolean) {
		this.settings.value = {
			...this.settings.value,
			privacy: {
				...this.privacy,
				errorReporting: enabled
			}
		};
	}

	// Fetch available models from the API
	async fetchModels(overrideBaseUrl?: string, overrideApiKey?: string): Promise<string[]> {
		const baseUrl = overrideBaseUrl || this.effectiveBaseUrl;
		const apiKey = overrideApiKey || this.api.apiKey;

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
