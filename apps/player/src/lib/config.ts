import { PUBLIC_API_BASE_URL, PUBLIC_SANDBOX_SITE_URL } from '$env/static/public';

export const API_BASE_URL = PUBLIC_API_BASE_URL || 'http://localhost:8787/api';

export const SANDBOX_SITE_URL_TEMPLATE = PUBLIC_SANDBOX_SITE_URL || undefined;
