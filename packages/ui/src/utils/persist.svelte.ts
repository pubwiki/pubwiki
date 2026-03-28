import { onMount } from 'svelte';

/**
 * Creates a persisted state value that syncs with localStorage
 * @param key The localStorage key
 * @param initialValue The initial value if nothing is stored
 * @returns An object with a reactive value property
 */
export default function persist<T>(key: string, initialValue: T) {
	let value = $state<T>(initialValue);

	onMount(() => {
		const currentValue = localStorage.getItem(key);
		if (currentValue) value = JSON.parse(currentValue);
	});

	return {
		get value() {
			return value;
		},
		set value(v: T) {
			value = v;
			// Save directly from parameter — NOT reading $state —
			// to avoid creating reactive subscriptions when called from $effect.
			if (v !== null && v !== undefined) {
				localStorage.setItem(key, JSON.stringify(v));
			} else {
				localStorage.removeItem(key);
			}
		}
	};
}
