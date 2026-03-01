<script lang="ts">
	/**
	 * Toggle - iOS-style toggle switch component
	 *
	 * Features:
	 * - Smooth animated transition
	 * - Label text with optional description
	 * - Size variants (sm, md)
	 * - Disabled state
	 * - Accessible (keyboard + screen reader)
	 */

	interface Props {
		/** Whether the toggle is on */
		checked?: boolean;
		/** Label text displayed next to the toggle */
		label?: string;
		/** Optional description text below the label */
		description?: string;
		/** Whether the toggle is disabled */
		disabled?: boolean;
		/** Size variant */
		size?: 'sm' | 'md';
		/** Callback when the toggle changes */
		onchange?: (checked: boolean) => void;
		/** Custom class for the root container */
		class?: string;
	}

	let {
		checked = $bindable(false),
		label,
		description,
		disabled = false,
		size = 'md',
		onchange,
		class: className = ''
	}: Props = $props();

	function toggle() {
		if (disabled) return;
		checked = !checked;
		onchange?.(checked);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex items-center gap-3 {disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} select-none {className}"
	onclick={toggle}
	onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
>
	{#if label || description}
		<div class="flex-1 min-w-0">
			{#if label}
				<span class="{size === 'sm' ? 'text-xs' : 'text-sm'} font-medium text-gray-700 leading-tight">{label}</span>
			{/if}
			{#if description}
				<p class="text-xs text-gray-400 mt-0.5 leading-snug">{description}</p>
			{/if}
		</div>
	{/if}

	<!-- Track -->
	<span
		role="switch"
		aria-checked={checked}
		aria-label={label}
		tabindex={disabled ? -1 : 0}
		class="relative inline-flex shrink-0 rounded-full transition-colors duration-200 ease-in-out
			focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
		style="width: {size === 'sm' ? '32px' : '40px'}; height: {size === 'sm' ? '18px' : '24px'}; background-color: {checked ? 'rgb(37 99 235)' : 'rgb(209 213 219)'};"
	>
		<!-- Thumb -->
		<span
			class="pointer-events-none absolute rounded-full bg-white shadow-sm"
			style="width: {size === 'sm' ? '14px' : '20px'}; height: {size === 'sm' ? '14px' : '20px'}; top: 50%; left: 2px; transform: translateY(-50%) translateX({checked ? (size === 'sm' ? '14px' : '16px') : '0px'}); transition: transform 200ms ease-in-out;"
		></span>
	</span>
</div>
