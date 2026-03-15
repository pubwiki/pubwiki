<script lang="ts">
	/**
	 * PubWikiConfirmDialog - Player wrapper with paraglide i18n labels
	 */
	import type { Component } from 'svelte';
	import {
		PubWikiConfirmDialog as SharedDialog,
		type PubWikiConfirmDialogLabels,
		type FormComponentProps,
		type ConfirmationType,
	} from '@pubwiki/ui/components';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		type: ConfirmationType;
		FormComponent: Component<FormComponentProps>;
		initialValues: Record<string, unknown>;
		onConfirm: (editedValues: Record<string, unknown>) => void;
		onCancel: () => void;
	}

	let { type, FormComponent, initialValues, onConfirm, onCancel }: Props = $props();

	const labels: PubWikiConfirmDialogLabels = {
		title: m.player_pubwiki_confirm_title(),
		description: m.player_pubwiki_confirm_desc(),
		warning: m.player_pubwiki_confirm_warning(),
		cancel: m.player_pubwiki_cancel(),
		confirm: m.player_pubwiki_confirm(),
		actionLabel: (t: ConfirmationType) =>
			t === 'publish' ? m.player_pubwiki_action_publish() : m.player_pubwiki_action_article(),
	};
</script>

<SharedDialog
	{type}
	{FormComponent}
	{initialValues}
	{onConfirm}
	{onCancel}
	{labels}
/>
