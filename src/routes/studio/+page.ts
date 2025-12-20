import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	// Generate a temporary UUID for new projects
	const tempId = crypto.randomUUID();
	
	// Redirect to the project-specific studio page
	throw redirect(307, `/studio/${tempId}`);
};
