/**
 * Singleton API client for the Hub application
 * 
 * Best practice: Import and use this client throughout the app
 * instead of creating new instances with createApiClient()
 */
import { createApiClient } from '@pubwiki/api/client';
import { API_BASE_URL } from '$lib/config';

export const apiClient = createApiClient(API_BASE_URL);
