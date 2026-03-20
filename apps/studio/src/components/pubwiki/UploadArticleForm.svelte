<script lang="ts">
	/**
	 * UploadArticleForm - Studio wrapper with paraglide i18n labels + Lexical editor
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
		title: m.studio_pubwiki_field_title(),
		titlePlaceholder: m.studio_pubwiki_field_title_placeholder(),
		visibility: m.studio_pubwiki_field_visibility(),
		visibilityPublic: m.studio_pubwiki_visibility_public(),
		visibilityPrivate: m.studio_pubwiki_visibility_private(),
		visibilityUnlisted: m.studio_pubwiki_visibility_unlisted(),
		content: m.studio_pubwiki_field_content(),
	};
</script>

<SharedForm {initialValues} {onValuesChange} {labels} EditorComponent={Editor as import('svelte').Component<{ content: unknown[]; onContentChange: (content: unknown[]) => void }>} />
