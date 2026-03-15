<script lang="ts">
	/**
	 * PublishForm - Player wrapper with paraglide i18n labels + thumbnail upload + author
	 */
	import { PublishForm as SharedPublishForm, type PublishFormLabels } from '@pubwiki/ui/components';
	import { useAuth } from '@pubwiki/ui/stores';
	import { createApiClient } from '@pubwiki/api/client';
	import { API_BASE_URL } from '$lib/config';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
	}

	let { initialValues, onValuesChange }: Props = $props();

	const auth = useAuth();
	const apiClient = createApiClient(API_BASE_URL);
	const authorName = $derived(auth.user?.displayName || auth.user?.username || 'Anonymous');

	async function handleUploadThumbnail(file: File): Promise<string | null> {
		const baseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
		try {
			const { data, error } = await apiClient.POST('/images', {
				// @ts-expect-error openapi-fetch types file as string, but bodySerializer handles actual File
				body: { file, purpose: 'thumbnail' },
				bodySerializer: (body: Record<string, unknown>) => {
					const formData = new FormData();
					formData.append('file', body.file as File);
					if (body.purpose) formData.append('purpose', body.purpose as string);
					return formData;
				},
			});
			if (error || !data) return null;
			return `${baseUrl}${data.url}`;
		} catch {
			return null;
		}
	}

	const labels: PublishFormLabels = {
		name: m.player_pubwiki_field_name(),
		namePlaceholder: m.player_pubwiki_field_name_placeholder(),
		description: m.player_pubwiki_field_description(),
		descriptionPlaceholder: m.player_pubwiki_field_description_placeholder(),
		version: m.player_pubwiki_field_version(),
		visibility: m.player_pubwiki_field_visibility(),
		visibilityPublic: m.player_pubwiki_visibility_public(),
		visibilityPrivate: m.player_pubwiki_visibility_private(),
		visibilityUnlisted: m.player_pubwiki_visibility_unlisted(),
		homepage: m.player_pubwiki_field_homepage(),
		homepagePlaceholder: m.player_pubwiki_field_homepage_placeholder(),
		homepageHelp: m.player_pubwiki_field_homepage_help(),
		preview: m.player_pubwiki_field_preview(),
	};
</script>

<SharedPublishForm {initialValues} {onValuesChange} {labels} {authorName} onUploadThumbnail={handleUploadThumbnail} />
