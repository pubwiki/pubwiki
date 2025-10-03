<template>
  <div class="wf-container">
    <div class="wf-pane wf-auth">
      <div class="wf-box">
        <h2>{{ t('wikifarm-login-title') }}</h2>
        <div v-if="state.isLoggedIn" class="wf-note">{{ state.username }}</div>
        <form v-else @submit.prevent="onLogin">
          <cdx-field :label="t('wikifarm-login-username')">
            <cdx-text-input v-model="state.login.username" :placeholder="t('wikifarm-login-username')" autocomplete="username" />
          </cdx-field>
          <cdx-field :label="t('wikifarm-login-password')">
            <cdx-text-input v-model="state.login.password" :placeholder="t('wikifarm-login-password')" type="password" autocomplete="current-password" />
          </cdx-field>
          <cdx-field class="wf-checkbox">
            <label class="cdx-checkbox">
              <input type="checkbox" v-model="state.login.remember" />
              <span>{{ t('wikifarm-login-remember') }}</span>
            </label>
          </cdx-field>
          <div class="wf-actions">
            <cdx-button weight="primary" :disabled="state.loading.login">{{ t('wikifarm-login-submit') }}</cdx-button>
          </div>
          <cdx-message v-if="state.error.login" type="error">{{ state.error.login }}</cdx-message>
        </form>
      </div>
    </div>
    <div class="wf-pane wf-content">
      <section v-if="state.isLoggedIn" class="wf-section">
        
        <div class="wf-slug-inline">
            <cdx-field :label="t('wikifarm-create-name')">
                <cdx-text-input v-model="state.form.name" :placeholder="t('wikifarm-create-name')" />
            </cdx-field>
            <div class="wf-slug-suffix">位于</div>
            
      <cdx-field style="margin-top: 0px;" :label="t('wikifarm-create-slug')" :help-text="t('wikifarm-slug-help')">
        <cdx-text-input v-model="state.form.slug" placeholder="子域名" @input="onSlugInput" />
        <div v-if="state.slugCheck.status==='checking'" class="wf-hint">{{ t('wikifarm-slug-checking') }}</div>
        <div v-else-if="state.slugCheck.status==='exists'" class="wf-hint wf-err">{{ t('wikifarm-slug-exists') }}</div>
        <div v-else-if="state.slugCheck.status==='available'" class="wf-hint wf-ok">{{ t('wikifarm-slug-available') }}</div>
      </cdx-field>
            <div class="wf-slug-suffix">.pub.wiki</div>
        </div>
        <div class="wf-actions">
          <cdx-button weight="primary" :disabled="!!state.sse || state.loading.create" @click="onSubmit">{{ t('wikifarm-create-submit') }}</cdx-button>
        </div>
        <cdx-message v-if="state.error.create" type="error">{{ state.error.create }}</cdx-message>
        <div v-if="state.task.id" class="wf-progress" :class="{'wf-progress-failed': state.task.status==='failed', 'wf-progress-succeeded': state.task.status==='succeeded'}">
          <div>
            <template v-if="state.task.status==='failed'">{{ t('wikifarm-create-failed') }}</template>
            <template v-else-if="state.task.status==='succeeded'">{{ t('wikifarm-create-succeeded') }}</template>
            <template v-else>{{ t('wikifarm-create-progress', state.task.progress + '%') }}</template>
          </div>
          <cdx-progress-bar :value="state.task.progress" />
          <div v-if="state.task.message" class="wf-progress-msg">{{ state.task.message }}</div>
        </div>
      </section>

      <section class="wf-section">
        <h2>{{ t('wikifarm-public-title', t('wikifarm-featured-title')) }}</h2>
        <div v-if="state.loading.public">{{ t('wikifarm-loading') }}</div>
        <cdx-message v-else-if="!state.publicWikis.length" type="notice">{{ t('wikifarm-public-empty', t('wikifarm-featured-empty')) }}</cdx-message>
        <ul v-else class="wf-list">
          <li v-for="w in state.publicWikis" :key="w.id"><a :href="wikiHref(w)" target="_blank" rel="noopener noreferrer">{{ w.name }}</a></li>
        </ul>
      </section>
      <section v-if="state.isLoggedIn" class="wf-section">
        <h2>{{ t('wikifarm-mywikis-title') }}</h2>
        <div v-if="state.loading.my">{{ t('wikifarm-loading') }}</div>
        <cdx-message v-else-if="!state.myWikis.length" type="notice">{{ t('wikifarm-mywikis-empty') }}</cdx-message>
        <ul v-else class="wf-list">
          <li v-for="w in state.myWikis" :key="w.id"><a :href="wikiHref(w)" target="_blank" rel="noopener noreferrer">{{ w.name }}</a></li>
        </ul>
      </section>
    </div>
  </div>
  
</template>

<script>
const { reactive, onMounted, onBeforeUnmount } = require( 'vue' );
const { CdxField, CdxTextInput, CdxButton, CdxMessage, CdxProgressBar } = require( '../../codex.js' );

const msg = mw.message.bind( mw );
const cfg = mw.config.get( 'wgWikiFarm' ) || {};
// Microservice base path (proxied by Traefik). Allow override via config (e.g. cfg.provisionerBase)
const serviceBase = ( cfg.provisionerBase || '/provisioner/v1' ).replace(/\/$/, '');

function t( key, ...params ) { return msg( key, ...params ).text(); }
function notify( message, opts ) {
  if ( typeof mw.notify === 'function' ) {
    try { mw.notify( message, opts ); } catch ( e ) { /* noop */ }
  } else {
    // Fallback to console to avoid hard dependency on mediawiki.notify
    if ( window.console && console.log ) { console.log( '[notify]', message ); }
  }
}
function apiFetch( path, options = {} ) {
  return fetch( serviceBase + path, Object.assign( { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, options ) )
    .then( async ( res ) => {
      const ct = res.headers.get( 'Content-Type' ) || '';
      const payload = ct.includes( 'application/json' ) ? await res.json() : await res.text();
      if ( !res.ok ) { const err = new Error( 'HTTP ' + res.status ); err.status = res.status; err.payload = payload; throw err; }
      return payload;
    } );
}
function startSSE( taskId, onEvent, opts = {} ) {
  const debug = opts.debug !== false; // default on
  const url = serviceBase + '/tasks/' + encodeURIComponent( taskId ) + '/events';
  if ( debug ) console.log( '[wikifarm][sse] opening', url );
  const es = new EventSource( url );

  function safeParse( raw, typeHint ) {
    try { return JSON.parse( raw ); }
    catch ( e ) {
      if ( debug ) console.warn( '[wikifarm][sse] JSON parse failed', { type: typeHint, raw, error: e } );
      return null;
    }
  }

  function handle( evtType, ev ) {
    const raw = ev.data;
    if ( debug ) console.log( '[wikifarm][sse] event', evtType, raw );
    const parsed = safeParse( raw, evtType );
    if ( parsed ) {
      try { onEvent( evtType, parsed ); }
      catch ( e ) { if ( debug ) console.error( '[wikifarm][sse] callback error', e ); }
    }
  }

  es.addEventListener( 'progress', ( ev ) => handle( 'progress', ev ) );
  es.addEventListener( 'status', ( ev ) => handle( 'status', ev ) );

  // If for some reason custom event names fail, fall back to generic message listener
  es.addEventListener( 'message', ( ev ) => {
    if ( debug ) console.log( '[wikifarm][sse] generic message', ev.data );
    const parsed = safeParse( ev.data, 'message' );
    if ( parsed && parsed.type && ( parsed.type === 'progress' || parsed.type === 'status' ) ) {
      try { onEvent( parsed.type, parsed ); } catch ( e ) { /* ignore */ }
    }
  } );

  es.onopen = () => { if ( debug ) console.log( '[wikifarm][sse] open (readyState=' + es.readyState + ')' ); };
  es.onerror = ( e ) => {
    // readyState 2 means closed
    if ( debug ) console.warn( '[wikifarm][sse] error', e, 'readyState=' + es.readyState );
  };
  return es;
}

module.exports = {
  name: 'WikiFarmApp',
  components: {
    CdxField,
    CdxTextInput,
    CdxButton,
    CdxMessage,
    CdxProgressBar
  },
  setup() {
    const state = reactive( {
      isLoggedIn: !!cfg.isLoggedIn,
      username: cfg.username || '',
      userId: cfg.userId || null,
  publicWikis: [],
      myWikis: [],
    loading: { public: false, my: false, create: false, login: false },
  error: { public: '', my: '', create: '', login: '' },
      login: { username: '', password: '', remember: true },
  form: { name: '', slug: '', visibility: 'public' },
    slugCheck: { status: '', timer: null },
      task: { id: null, status: '', progress: 0, message: '', phases: [] },
      sse: null
    } );


    const baseDomain = cfg.baseDomain || 'pub.wiki';
    function wikiHref( w ) {
      // Priority: explicit domain -> constructed from slug -> path -> '#'
      if ( w.domain ) {
        // Ensure protocol prefix not duplicated
        if ( /^https?:\/\//i.test( w.domain ) ) { return w.domain; }
        return window.location.protocol + '//' + w.domain;
      }
      if ( w.slug ) {
        return window.location.protocol + '//' + w.slug + '.' + baseDomain;
      }
      if ( w.path ) { return w.path; }
      return '#';
    }
    const loginUrl = mw.util.getUrl( 'Special:UserLogin' );

    function onLogin() {
      state.error.login = '';
      if ( !state.login.username || !state.login.password ) {
        state.error.login = t( 'wikifarm-error-field', t( 'wikifarm-login-username' ) + ', ' + t( 'wikifarm-login-password' ) );
        return;
      }
      const api = new mw.Api();
      state.loading.login = true;
      const returnUrl = new URL( mw.util.getUrl( 'Special:WikiFarm' ), window.location.origin ).toString();
      api.get( { action: 'query', meta: 'tokens', type: 'login', format: 'json' } ).then( ( data ) => {
        const token = data && data.query && data.query.tokens && data.query.tokens.logintoken;
        if ( !token ) { throw new Error( 'no token' ); }
        return api.post({
          action: 'clientlogin',
          username: state.login.username,
          password: state.login.password,
          rememberMe: state.login.remember ? 1 : 0,
          loginreturnurl: returnUrl,
          format: 'json',
          logintoken: token
        } );
      } ).then( ( res ) => {
        const r = res && res.clientlogin;
        if ( r && r.status === 'PASS' ) {
          // Refresh the page (use redirecturl if provided) so the skin header updates
          var to = ( r.redirecturl && String( r.redirecturl ) ) || returnUrl;
          window.location.assign( to );
          return; // stop further handling
        } else {
          const e = ( r && ( r.info || r.messagecode ) ) || 'login-failed';
          state.error.login = t( 'wikifarm-login-failed' );
        }
      } ).catch( () => {
        state.error.login = t( 'wikifarm-login-failed' );
      } ).always( () => {
        state.loading.login = false;
      } );
    }

    function validate() {
      const errs = [];
      if ( !state.form.name.trim() ) errs.push( t( 'wikifarm-error-field', t( 'wikifarm-create-name' ) ) );
      if ( !/^[a-z0-9-]{3,120}$/.test( state.form.slug ) ) errs.push( t( 'wikifarm-invalid-slug' ) );
      if ( state.slugCheck.status === 'exists' ) errs.push( t( 'wikifarm-slug-exists' ) );
      return errs;
    }
    function checkSlugNow() {
      const slug = state.form.slug.trim();
      if ( !/^[a-z0-9-]{3,120}$/.test( slug ) ) { state.slugCheck.status=''; return; }
      state.slugCheck.status = 'checking';
      apiFetch( '/wikis/slug/' + encodeURIComponent( slug ) + '/exists' )
        .then( ( data ) => {
          state.slugCheck.status = ( data && data.exists ) ? 'exists' : 'available';
        } )
        .catch( () => { state.slugCheck.status=''; } );
    }
    function onSlugInput() {
      if ( state.slugCheck.timer ) { clearTimeout( state.slugCheck.timer ); }
      state.slugCheck.timer = setTimeout( () => { checkSlugNow(); }, 400 );
    }

    function resetTask() {
      if ( state.sse ) { try { state.sse.close(); } catch ( e ) {} state.sse = null; }
      state.task = { id: null, status: '', progress: 0, message: '', phases: [] };
    }

    function fetchPublic() {
      state.loading.public = true; state.error.public = '';
      // New endpoint: GET /wikis/public
      apiFetch( '/wikis/public' )
        .then( ( data ) => { state.publicWikis = ( data && data.wikis ) || []; } )
        .catch( () => { state.error.public = t( 'wikifarm-load-failed' ); } )
        .finally( () => { state.loading.public = false; } );
    }
    function fetchMyWikis() {
      if ( !state.isLoggedIn ) return;
      state.loading.my = true; state.error.my = '';
      if ( !state.userId ) { state.loading.my = false; return; }
      apiFetch( '/users/' + encodeURIComponent( state.userId ) + '/wikis' )
        .then( ( data ) => { state.myWikis = ( data && data.wikis ) || []; } )
        .catch( () => { state.error.my = t( 'wikifarm-load-failed' ); } )
        .finally( () => { state.loading.my = false; } );
    }

    function onSubmit() {
      const errs = validate();
      if ( errs.length ) { state.error.create = errs.join( '\n' ); return; }
      state.error.create = '';
      state.loading.create = true;
      resetTask();
      const payload = { name: state.form.name.trim(), slug: state.form.slug, visibility: state.form.visibility };
      apiFetch( '/wikis', { method: 'POST', body: JSON.stringify( payload ) } )
        .then( ( data ) => {
          if ( data && data.task_id ) {
            state.task.id = data.task_id;
            notify( t( 'wikifarm-sse-connecting' ) );
            const phaseOrder = [ 'dir_copy', 'render_ini', 'db_provision', 'oauth', 'docker_install', 'docker_index_cfg', 'flip_bootstrap', 'index' ];
            function recalcProgress() {
              if ( state.task.status === 'succeeded' || state.task.status === 'failed' ) { state.task.progress = 100; return; }
              if ( !state.task.phases.length ) { state.task.progress = 2; return; }
              const completed = state.task.phases.length;
              const total = phaseOrder.length;
              state.task.progress = Math.min( 99, Math.round( ( completed / total ) * 100 ) );
            }
            console.log("start sse")
            state.sse = startSSE( data.task_id, ( type, d ) => {
              console.log("sse: " + d)
              if ( type === 'progress' ) {
                state.task.status = ( d.status || 'running' );
                if ( d.phase && !state.task.phases.includes( d.phase ) ) {
                  state.task.phases.push( d.phase );
                }
                state.task.message = d.message || '';
                recalcProgress();
              } else if ( type === 'status' ) {
                state.task.status = d.status;
                state.task.message = d.message || '';
                recalcProgress();
                if ( d.status === 'succeeded' ) { notify( t( 'wikifarm-sse-completed' ) ); fetchMyWikis(); }
                else if ( d.status === 'failed' ) { notify( t( 'wikifarm-sse-failed', d.message || '' ), { type: 'error' } ); }
                try { state.sse && state.sse.close(); } catch ( e ) {}
                state.sse = null; state.loading.create = false;
              }
            } );
          } else { throw new Error( 'No task_id' ); }
        } )
        .catch( () => { state.error.create = t( 'wikifarm-create-error' ); state.loading.create = false; } );
    }

  onMounted( () => { fetchPublic(); fetchMyWikis(); } );
    onBeforeUnmount( () => { try { state.sse && state.sse.close(); } catch ( e ) {} } );

    return { state, onSubmit, onLogin, t, wikiHref, loginUrl, onSlugInput };
  }
};
</script>
