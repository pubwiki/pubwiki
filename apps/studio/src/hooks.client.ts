import { handleErrorWithSentry, replayIntegration } from "@sentry/sveltekit";
import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';

// Disable Sentry entirely in local dev mode
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
  dsn: 'https://6fa7e365a1e4dcd8bb11e196e6f02249@o4510979898146816.ingest.us.sentry.io/4510979903062016',
  enabled,

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // If the entire session is not sampled, use the below sample rate to sample
  // sessions when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // If you don't want to use Session Replay, just remove the line below:
  integrations: [replayIntegration()],

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/sveltekit/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Only send events when user has opted in to error reporting
  beforeSend(event) {
    return isErrorReportingEnabled() ? event : null;
  },
});

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
