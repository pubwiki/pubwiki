import { handleErrorWithSentry, replayIntegration } from "@sentry/sveltekit";
import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';

const enabled = !dev;

function isErrorReportingEnabled(): boolean {
  try {
    const raw = localStorage.getItem('user_settings');
    if (!raw) return false;
    const settings = JSON.parse(raw);
    return settings?.privacy?.errorReporting === true;
  } catch {
    return false;
  }
}

Sentry.init({
  dsn: 'https://de315f49fc8d09775d4130cd15e2219a@o4510979898146816.ingest.us.sentry.io/4511126302883840',
  enabled,

  tracesSampleRate: 1.0,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [replayIntegration()],

  sendDefaultPii: true,

  beforeSend(event) {
    return isErrorReportingEnabled() ? event : null;
  },
});

export const handleError = handleErrorWithSentry();
