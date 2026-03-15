/**
 * PubWiki Confirmation Store
 *
 * Shared state for controller ↔ UI confirmation dialog communication.
 * Supports caller-provided custom form components.
 */

import type { Component } from 'svelte';

export type ConfirmationType = 'publish' | 'uploadArticle' | 'uploadCheckpoint' | 'uploadCheckpoints';

/** Props interface for form components */
export interface FormComponentProps {
	initialValues: Record<string, unknown>;
	onValuesChange: (values: Record<string, unknown>) => void;
}

export interface PendingConfirmation {
	id: string;
	type: ConfirmationType;
	/** Caller-provided form component */
	formComponent: Component<FormComponentProps>;
	/** Initial field values */
	initialValues: Record<string, unknown>;
	/** Resolves with edited values on confirm, null on cancel */
	resolve: (editedValues: Record<string, unknown> | null) => void;
}

let pendingConfirmation = $state<PendingConfirmation | null>(null);
let nextId = 1;

/**
 * Get current pending confirmation (for UI layer)
 */
export function getPendingConfirmation(): PendingConfirmation | null {
	return pendingConfirmation;
}

/**
 * Request user confirmation (for controller layer)
 * @returns Promise that resolves with edited values on confirm, null on cancel
 */
export function requestConfirmation(
	type: ConfirmationType,
	formComponent: Component<FormComponentProps>,
	initialValues: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const id = `confirm-${nextId++}`;
		pendingConfirmation = {
			id,
			type,
			formComponent,
			initialValues,
			resolve: (editedValues: Record<string, unknown> | null) => {
				pendingConfirmation = null;
				resolve(editedValues);
			}
		};
	});
}

/**
 * Respond to pending confirmation (for UI layer)
 * @param editedValues Edited values on confirm, null on cancel
 */
export function respondConfirmation(editedValues: Record<string, unknown> | null): void {
	if (pendingConfirmation) {
		pendingConfirmation.resolve(editedValues);
	}
}
