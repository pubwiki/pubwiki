import type { ConfirmationType } from './pubwiki-confirm.svelte';

/** Labels for the PubWikiConfirmDialog component */
export interface PubWikiConfirmDialogLabels {
	title: string;
	description: string;
	warning: string;
	cancel: string;
	confirm: string;
	/** Returns the display text for a given confirmation type */
	actionLabel: (type: ConfirmationType) => string;
}

/** Labels for the PublishForm component */
export interface PublishFormLabels {
	name: string;
	namePlaceholder: string;
	description: string;
	descriptionPlaceholder: string;
	version: string;
	visibility: string;
	visibilityPublic: string;
	visibilityPrivate: string;
	visibilityUnlisted: string;
	homepage: string;
	homepagePlaceholder: string;
	homepageHelp: string;
	preview: string;
}

/** Labels for the UploadArticleForm component */
export interface UploadArticleFormLabels {
	title: string;
	titlePlaceholder: string;
	visibility: string;
	visibilityPublic: string;
	visibilityPrivate: string;
	visibilityUnlisted: string;
	content: string;
}

/** Labels for the UploadCheckpointForm component */
export interface UploadCheckpointFormLabels {
	name: string;
	namePlaceholder: string;
	description: string;
	descriptionPlaceholder: string;
	visibility: string;
	visibilityPublic: string;
	visibilityPrivate: string;
	visibilityUnlisted: string;
}

/** Labels for the UploadCheckpointsForm component */
export interface UploadCheckpointsFormLabels {
	count: (count: number) => string;
	defaultVisibility: string;
	visibilityPublic: string;
	visibilityPrivate: string;
	visibilityUnlisted: string;
	visibilityHint: string;
}
