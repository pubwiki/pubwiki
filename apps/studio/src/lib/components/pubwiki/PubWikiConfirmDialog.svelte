<script lang="ts">
	/**
	 * PubWikiConfirmDialog - 确认弹窗组件
	 * 
	 * 全屏遮罩 + Portal 渲染，确保在 sandbox 全屏模式下也能正常显示
	 * 接受调用者传入的自定义表单组件
	 */
	import { fade } from 'svelte/transition';
	import { untrack } from 'svelte';
	import type { Component } from 'svelte';
	import type { FormComponentProps, ConfirmationType } from '$lib/state/pubwiki-confirm.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		type: ConfirmationType;
		/** 调用者传入的表单组件 */
		FormComponent: Component<FormComponentProps>;
		initialValues: Record<string, unknown>;
		onConfirm: (editedValues: Record<string, unknown>) => void;
		onCancel: () => void;
	}

	let { type, FormComponent, initialValues, onConfirm, onCancel }: Props = $props();

	// Capture initial values once (intentionally not reactive to props changes)
	const initValues = untrack(() => ({ ...initialValues }));
	let currentValues = $state(initValues);

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode === document.body) {
					document.body.removeChild(node);
				}
			}
		};
	}

	function handleConfirm() {
		onConfirm(currentValues);
	}

	function handleValuesChange(values: Record<string, unknown>) {
		currentValues = values;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore state_referenced_locally -->
<div
	use:portal
	class="fixed inset-0 z-99999 flex items-center justify-center bg-black/80"
	transition:fade={{ duration: 150 }}
	role="dialog"
	aria-modal="true"
	aria-labelledby="pubwiki-confirm-title"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="dialog-container bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="p-6">
			<div class="flex items-center gap-3 mb-4">
				<div class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
				</div>
				<h3 id="pubwiki-confirm-title" class="text-lg font-semibold text-gray-900">
					{m.studio_pubwiki_confirm_title()}
				</h3>
			</div>

			<p class="text-gray-600 mb-4">{m.studio_pubwiki_confirm_desc()}</p>

			<!-- 操作类型 -->
			<div class="text-sm font-medium text-gray-700 mb-3">
				{type === 'publish' ? m.studio_pubwiki_action_publish() : m.studio_pubwiki_action_article()}
			</div>

			<!-- 调用者传入的自定义表单组件 -->
			<div class="bg-gray-50 rounded-lg p-4 mb-4">
				<FormComponent {initialValues} onValuesChange={handleValuesChange} />
			</div>

			<p class="text-sm text-amber-600 mb-6">{m.studio_pubwiki_confirm_warning()}</p>

			<!-- Buttons at the end of content -->
			<div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
				<button
					class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
					onclick={onCancel}
				>
					{m.studio_pubwiki_cancel()}
				</button>
				<button
					class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
					onclick={handleConfirm}
				>
					{m.studio_pubwiki_confirm()}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Scrollbar styling */
	.dialog-container {
		scrollbar-width: thin;
		scrollbar-color: #d1d5db transparent;
	}
	.dialog-container::-webkit-scrollbar {
		width: 8px;
	}
	.dialog-container::-webkit-scrollbar-track {
		background: transparent;
	}
	.dialog-container::-webkit-scrollbar-thumb {
		background-color: #d1d5db;
		border-radius: 4px;
		border: 2px solid transparent;
		background-clip: content-box;
	}
	.dialog-container::-webkit-scrollbar-thumb:hover {
		background-color: #9ca3af;
	}
	/* Hide all scrollbar arrows/buttons */
	.dialog-container::-webkit-scrollbar-button {
		display: none !important;
		width: 0 !important;
		height: 0 !important;
		background: transparent !important;
	}
	.dialog-container::-webkit-scrollbar-button:start:decrement,
	.dialog-container::-webkit-scrollbar-button:end:increment,
	.dialog-container::-webkit-scrollbar-button:vertical:start:increment,
	.dialog-container::-webkit-scrollbar-button:vertical:end:decrement {
		display: none !important;
	}
	.dialog-container::-webkit-scrollbar-corner {
		background: transparent;
	}
</style>
