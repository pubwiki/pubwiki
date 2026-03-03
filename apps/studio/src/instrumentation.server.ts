import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: 'https://6fa7e365a1e4dcd8bb11e196e6f02249@o4510979898146816.ingest.us.sentry.io/4510979903062016',

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: import.meta.env.DEV,
});