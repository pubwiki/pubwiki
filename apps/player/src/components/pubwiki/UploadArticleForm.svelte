<script lang="ts">
	/**
	 * UploadArticleForm - Player wrapper with paraglide i18n labels + Lexical editor
	 */
	import { UploadArticleForm as SharedForm, type UploadArticleFormLabels } from '@pubwiki/ui/components';
	import { Editor } from '@pubwiki/reader';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
	}

	let { initialValues, onValuesChange }: Props = $props();

	const labels: UploadArticleFormLabels = {
		title: m.player_pubwiki_field_title(),
		titlePlaceholder: m.player_pubwiki_field_title_placeholder(),
		visibility: m.player_pubwiki_field_visibility(),
		visibilityPublic: m.player_pubwiki_visibility_public(),
		visibilityPrivate: m.player_pubwiki_visibility_private(),
		visibilityUnlisted: m.player_pubwiki_visibility_unlisted(),
		content: m.player_pubwiki_field_content(),
	};
</script>

<SharedForm {initialValues} {onValuesChange} {labels} EditorComponent={Editor as any} />
