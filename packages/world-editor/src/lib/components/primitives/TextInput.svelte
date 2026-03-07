<!--
  TextInput — A styled text input.
-->
<script lang="ts">
	interface Props {
		value: string;
		onchange: (value: string) => void;
		placeholder?: string;
		type?: 'text' | 'number';
		class?: string;
	}

	let { value, onchange, placeholder = '', type = 'text', class: className = '' }: Props = $props();
</script>

<input
	{type}
	{value}
	{placeholder}
	class="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 {className}"
	oninput={(e) => onchange(e.currentTarget.value)}
/>
