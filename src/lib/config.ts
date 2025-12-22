import { PUBLIC_API_BASE_URL } from '$env/static/public';

/**
 * API Base URL for backend services
 * Configured via PUBLIC_API_BASE_URL environment variable
 * Defaults to localhost:8787/api for development
 */
export const API_BASE_URL = PUBLIC_API_BASE_URL || 'http://localhost:8787/api';
