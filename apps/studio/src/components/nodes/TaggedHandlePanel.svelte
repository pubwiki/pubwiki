<script lang="ts">
	/**
	 * TaggedHandlePanel - A reusable panel for displaying tagged handles
	 * 
	 * Features:
	 * - Panel with rounded corners positioned to the left of the node
	 * - Each tag has a bullet-tip shape with rounded right corners
	 * - Handles positioned at the tip of each tag
	 * - Supports connected/disconnected states with different colors
	 * - Each handle can have its own color scheme
	 * - Optional "add" handle at the bottom for creating new handles
	 * - Editable handles with inline input
	 */
	import { Handle, Position } from '@xyflow/svelte';
	import { tick } from 'svelte';

	// ============================================================================
	// Types
	// ============================================================================

	export interface HandleColorScheme {
		bg: string;
		border: string;
		text: string;
		handle: string;
	}

	export interface TaggedHandle {
		/** Unique identifier for this handle, will be used as handle id */
		id: string;
		/** Display label for the tag */
		label: string;
		/** Whether this handle is connected */
		isConnected: boolean;
		/** Optional color scheme for connected state (overrides default) */
		connectedColor?: HandleColorScheme;
		/** Optional color scheme for disconnected state (overrides default) */
		disconnectedColor?: HandleColorScheme;
		/** Whether this handle is currently being edited */
		isEditing?: boolean;
		/** Whether to use editable mode with dynamic width */
		editable?: boolean;
		/** Optional custom data associated with this handle */
		data?: Record<string, unknown>;
	}

	export interface AddHandleConfig {
		/** Handle ID for the add button */
		id: string;
		/** Label to display (e.g., "mount") */
		label: string;
		/** Color scheme for the add button */
		color: HandleColorScheme;
	}

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		/** Array of tagged handles to display */
		handles: TaggedHandle[];
		/** Whether handles can be connected */
		isConnectable?: boolean;
		/** Handle type: 'source' or 'target' */
		handleType?: 'source' | 'target';
		/** Position of the panel: 'left' or 'right' */
		position?: 'left' | 'right';
		/** How far the panel extends into the node (in pixels) */
		nodeOverlap?: number;
		/** Default color scheme for connected state */
		defaultConnectedColor?: HandleColorScheme;
		/** Default color scheme for disconnected state */
		defaultDisconnectedColor?: HandleColorScheme;
		/** Optional "add" handle configuration - displays a + button at the bottom */
		addHandle?: AddHandleConfig;
		/** Callback when an editable handle's label changes */
		onLabelChange?: (handleId: string, oldLabel: string, newLabel: string, data?: Record<string, unknown>) => void;
		/** Callback when editing is complete (blur or enter) */
		onEditComplete?: (handleId: string) => void;
		/** Callback to validate a label - returns error message or null if valid */
		validateLabel?: (handleId: string, label: string, data?: Record<string, unknown>) => string | null;
		/** Callback when user clicks to start editing */
		onStartEdit?: (handleId: string, data?: Record<string, unknown>) => void;
		/** Callback when a handle tag is clicked (not in edit mode) */
		onClick?: (handleId: string, data?: Record<string, unknown>) => void;
	}

	const DEFAULT_CONNECTED_COLOR: HandleColorScheme = {
		bg: '#eff6ff',
		border: '#93c5fd',
		text: 'text-blue-600',
		handle: 'bg-blue-500'
	};

	const DEFAULT_DISCONNECTED_COLOR: HandleColorScheme = {
		bg: '#ffffff',
		border: '#d1d5db',
		text: 'text-gray-600',
		handle: 'bg-gray-400'
	};

	let {
		handles,
		isConnectable = true,
		handleType = 'target',
		position = 'left',
		nodeOverlap = 8,
		defaultConnectedColor = DEFAULT_CONNECTED_COLOR,
		defaultDisconnectedColor = DEFAULT_DISCONNECTED_COLOR,
		addHandle,
		onLabelChange,
		onEditComplete,
		validateLabel,
		onStartEdit,
		onClick
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	// Store widths for each tag to render the SVG background correctly
	let tagWidths = $state<Record<string, number>>({});
	
	// Store refs to input elements for focusing
	let inputRefs = $state<Record<string, HTMLInputElement | null>>({});
	
	// Store current edit values (to allow editing before committing)
	let editValues = $state<Record<string, string>>({});
	
	// Store validation errors for each handle
	let validationErrors = $state<Record<string, string | null>>({});
	
	// Store tooltip visibility
	let showTooltip = $state<Record<string, boolean>>({});

	// ============================================================================
	// Effects
	// ============================================================================
	
	// Auto-focus input when a handle enters edit mode
	$effect(() => {
		for (const handle of handles) {
			if (handle.isEditing) {
				// Initialize edit value with current label
				if (editValues[handle.id] === undefined) {
					editValues[handle.id] = handle.label;
				}
				tick().then(() => {
					const input = inputRefs[handle.id];
					if (input) {
						input.focus();
						// Position cursor at the end
						const len = input.value.length;
						input.setSelectionRange(len, len);
					}
				});
			}
		}
	});
	
	// Clean up edit values when editing ends
	$effect(() => {
		for (const handleId of Object.keys(editValues)) {
			const handle = handles.find(h => h.id === handleId);
			if (!handle?.isEditing) {
				delete editValues[handleId];
				delete validationErrors[handleId];
				delete showTooltip[handleId];
			}
		}
	});

	// ============================================================================
	// Helpers
	// ============================================================================

	function getTagPath(width: number) {
		// Ensure minimum width to avoid rendering artifacts
		const w = Math.max(width, 8);
		// Path with bullet tip on left and rounded corners on right
		return `M ${w - 3} 0.5 L 5.5 0.5 Q 3 0.5 2 2.5 L 1 8.5 Q 0.5 10 1 11.5 L 2 17.5 Q 3 19.5 5.5 19.5 L ${w - 3} 19.5 Q ${w} 19.5 ${w} 16.5 L ${w} 3.5 Q ${w} 0.5 ${w - 3} 0.5 Z`;
	}

	function getColors(handle: TaggedHandle): HandleColorScheme {
		if (handle.isConnected) {
			return handle.connectedColor ?? defaultConnectedColor;
		}
		return handle.disconnectedColor ?? defaultDisconnectedColor;
	}
	
	function handleInputChange(handle: TaggedHandle, value: string) {
		const handleId = handle.id;
		const originalLabel = handle.label;
		
		// Ensure the leading / is always present for mount paths
		if (originalLabel.startsWith('/') && !value.startsWith('/')) {
			value = '/' + value;
		}
		
		editValues[handleId] = value;
		
		// Validate on every change
		if (validateLabel) {
			validationErrors[handleId] = validateLabel(handleId, value, handle.data);
		}
	}
	
	function handleKeyDown(e: KeyboardEvent, handle: TaggedHandle) {
		const handleId = handle.id;
		const originalLabel = handle.label;
		const input = e.target as HTMLInputElement;
		const value = input.value;
		
		// Prevent deleting the leading /
		if (originalLabel.startsWith('/') && e.key === 'Backspace') {
			if (input.selectionStart === 1 && input.selectionEnd === 1) {
				e.preventDefault();
				return;
			}
			if (input.selectionStart === 0 && input.selectionEnd === 0) {
				e.preventDefault();
				return;
			}
		}
		
		// Prevent moving cursor before /
		if (originalLabel.startsWith('/') && e.key === 'ArrowLeft') {
			if (input.selectionStart === 1) {
				e.preventDefault();
				return;
			}
		}
		
		if (e.key === 'Enter') {
			e.preventDefault();
			const error = validationErrors[handleId];
			if (error) {
				// Show tooltip with error
				showTooltip[handleId] = true;
				// Hide after 2 seconds
				setTimeout(() => {
					showTooltip[handleId] = false;
				}, 2000);
				return;
			}
			// Valid - commit the change
			if (value !== originalLabel) {
				onLabelChange?.(handleId, originalLabel, value, handle.data);
			}
			onEditComplete?.(handleId);
		} else if (e.key === 'Escape') {
			onEditComplete?.(handleId);
		}
	}
	
	function handleBlur(handle: TaggedHandle) {
		const handleId = handle.id;
		const originalLabel = handle.label;
		const value = editValues[handleId] ?? originalLabel;
		const error = validationErrors[handleId];
		
		// If there's an error, revert to original
		if (error) {
			onEditComplete?.(handleId);
			return;
		}
		
		// Valid - commit if changed
		if (value !== originalLabel) {
			onLabelChange?.(handleId, originalLabel, value, handle.data);
		}
		onEditComplete?.(handleId);
	}
	
	function getDisplayValue(handle: TaggedHandle): string {
		if (handle.isEditing && editValues[handle.id] !== undefined) {
			return editValues[handle.id];
		}
		return handle.label;
	}
</script>

{#if handles.length > 0 || addHandle}
	<div class="absolute top-1/2 -translate-y-1/2 -z-10" style="right: calc(100% - {nodeOverlap}px);">
		<div class="bg-gray-100 border border-gray-50 rounded-lg flex flex-col justify-center items-end py-2 pr-7 gap-2 w-11 overflow-visible">
			{#each handles as handle (handle.id)}
				{@const colors = getColors(handle)}
				{@const hasError = !!validationErrors[handle.id]}
				{@const displayValue = getDisplayValue(handle)}
				
				<!-- Tag - extending left from panel -->
				<div class="flex items-center h-5 relative group" style="min-width: 1.5rem;" bind:clientWidth={tagWidths[handle.id]}>
					<!-- Full SVG Background & Border -->
					<div class="absolute inset-0 z-20 pointer-events-none">
						<svg width="100%" height="100%" viewBox="0 0 {tagWidths[handle.id] || 100} 20" class="overflow-visible block">
							{#if tagWidths[handle.id]}
								<path 
									d={getTagPath(tagWidths[handle.id])} 
									fill={hasError ? '#fef2f2' : colors.bg} 
									stroke={hasError ? '#ef4444' : colors.border}
									stroke-width="1"
									fill-rule="evenodd"
									stroke-linejoin="round"
								/>
							{/if}
						</svg>
					</div>

					<!-- Handle at the tip -->
					<div class="absolute left-[1.5px] top-1/2 z-30 w-0 h-0">
						<Handle 
							type={handleType}
							position={Position.Left}
							id={handle.id}
							isConnectable={isConnectable && !handle.isConnected}
							class="w-1.5! h-1.5! {colors.handle}! border-none! min-w-0! min-h-0! m-0! p-0!"
							style="position: absolute; top: 0; left: 0; transform: translate(-50%, -50%);"
						/>
					</div>

					<!-- Body Text or Editable Input -->
					<div class="relative z-20 pl-2 pr-1.5 text-[10px] font-medium {hasError ? 'text-red-600' : colors.text} whitespace-nowrap">
						{#if handle.isEditing}
							<!-- Hidden span to measure text width -->
							<span class="invisible absolute whitespace-pre text-[10px] font-medium" aria-hidden="true">{displayValue || '/'}</span>
							<input
								bind:this={inputRefs[handle.id]}
								type="text"
								value={displayValue}
								class="nodrag bg-transparent border-none outline-none text-[10px] font-medium {hasError ? 'text-red-600' : colors.text} p-0 m-0"
								style="width: {Math.max((displayValue.length || 1) * 0.6, 1)}em;"
								oninput={(e) => handleInputChange(handle, (e.target as HTMLInputElement).value)}
								onblur={() => handleBlur(handle)}
								onkeydown={(e) => handleKeyDown(e, handle)}
							/>
							<!-- Error Tooltip -->
							{#if showTooltip[handle.id] && validationErrors[handle.id]}
								<div class="absolute left-0 bottom-full mb-1 px-2 py-1 bg-red-500 text-white text-[9px] rounded shadow-lg whitespace-nowrap z-50">
									{validationErrors[handle.id]}
									<div class="absolute left-2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-500"></div>
								</div>
							{/if}
						{:else}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span 
								class="{handle.editable ? 'cursor-text hover:underline' : ''} {onClick ? 'cursor-pointer' : ''}"
								onclick={() => {
									if (handle.editable) {
										onStartEdit?.(handle.id, handle.data);
									} else if (onClick) {
										onClick(handle.id, handle.data);
									}
								}}
							>
								{handle.label}
							</span>
						{/if}
					</div>
				</div>
			{/each}
			
			<!-- Add Handle (optional) -->
			{#if addHandle}
				{@const addColors = addHandle.color}
				<div class="flex items-center h-5 relative group min-w-6" bind:clientWidth={tagWidths[addHandle.id]}>
					<!-- Full SVG Background & Border -->
					<div class="absolute inset-0 z-20 pointer-events-none">
						<svg width="100%" height="100%" viewBox="0 0 {tagWidths[addHandle.id] || 100} 20" class="overflow-visible block">
							{#if tagWidths[addHandle.id]}
								<path 
									d={getTagPath(tagWidths[addHandle.id])} 
									fill={addColors.bg} 
									stroke={addColors.border}
									stroke-width="1"
									fill-rule="evenodd"
									stroke-linejoin="round"
								/>
							{/if}
						</svg>
					</div>

					<!-- Plus sign at the tip (instead of circle handle) -->
					<div class="absolute left-[1.5px] top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
						<!-- Invisible Handle for connection detection -->
						<Handle 
							type={handleType}
							position={Position.Left}
							id={addHandle.id}
							{isConnectable}
							class="w-3! h-3! bg-transparent! border-none! min-w-0! min-h-0! m-0! p-0! opacity-0!"
							style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"
						/>
						<!-- Visible plus sign -->
						<svg class="w-2.5 h-2.5 {addColors.text}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4" />
						</svg>
					</div>

					<!-- Label -->
					<div class="relative z-20 pl-2 pr-1.5 text-[10px] font-medium {addColors.text} whitespace-nowrap">
						{addHandle.label}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
