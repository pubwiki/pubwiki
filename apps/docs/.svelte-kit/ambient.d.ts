
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const SHELL: string;
	export const npm_command: string;
	export const SESSION_MANAGER: string;
	export const COLORTERM: string;
	export const VSCODE_DEBUGPY_ADAPTER_ENDPOINTS: string;
	export const XDG_MENU_PREFIX: string;
	export const TERM_PROGRAM_VERSION: string;
	export const GTK_IM_MODULE: string;
	export const CONDA_EXE: string;
	export const npm_config_npm_globalconfig: string;
	export const FPATH: string;
	export const NODE: string;
	export const APPLICATIONS: string;
	export const SSH_AUTH_SOCK: string;
	export const npm_config_verify_deps_before_run: string;
	export const npm_config__jsr_registry: string;
	export const MEMORY_PRESSURE_WRITE: string;
	export const PYDEVD_DISABLE_FILE_VALIDATION: string;
	export const XMODIFIERS: string;
	export const DESKTOP_SESSION: string;
	export const SSH_AGENT_PID: string;
	export const NO_AT_BRIDGE: string;
	export const npm_config_globalconfig: string;
	export const LMOD_DIR: string;
	export const EDITOR: string;
	export const PWD: string;
	export const XDG_SESSION_DESKTOP: string;
	export const LOGNAME: string;
	export const XDG_SESSION_TYPE: string;
	export const MODULESHOME: string;
	export const MANPATH: string;
	export const npm_config_catalogs: string;
	export const PNPM_HOME: string;
	export const SYSTEMD_EXEC_PID: string;
	export const BUNDLED_DEBUGPY_PATH: string;
	export const OMF_PATH: string;
	export const npm_config_catalog: string;
	export const XAUTHORITY: string;
	export const VSCODE_GIT_ASKPASS_NODE: string;
	export const LIBCLANG_PATH: string;
	export const GJS_DEBUG_TOPICS: string;
	export const WINDOWPATH: string;
	export const VSCODE_INJECTION: string;
	export const GDM_LANG: string;
	export const HOME: string;
	export const USERNAME: string;
	export const LANG: string;
	export const XDG_CURRENT_DESKTOP: string;
	export const npm_package_version: string;
	export const WASMTIME_HOME: string;
	export const MEMORY_PRESSURE_WATCH: string;
	export const PYTHONSTARTUP: string;
	export const STARSHIP_SHELL: string;
	export const npm_config_proxy: string;
	export const LMOD_SETTARG_FULL_SUPPORT: string;
	export const DENO_INSTALL: string;
	export const GIT_ASKPASS: string;
	export const INVOCATION_ID: string;
	export const pnpm_config_verify_deps_before_run: string;
	export const LMOD_VERSION: string;
	export const MANAGERPID: string;
	export const INIT_CWD: string;
	export const CHROME_DESKTOP: string;
	export const STARSHIP_SESSION_KEY: string;
	export const npm_lifecycle_script: string;
	export const GJS_DEBUG_OUTPUT: string;
	export const MODULEPATH_ROOT: string;
	export const MOZ_GMP_PATH: string;
	export const UHD_IMAGES_DIR: string;
	export const VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
	export const VSCODE_PYTHON_AUTOACTIVATE_GUARD: string;
	export const XDG_SESSION_CLASS: string;
	export const LMOD_PKG: string;
	export const TERM: string;
	export const npm_package_name: string;
	export const PYTHON_BASIC_REPL: string;
	export const USER: string;
	export const npm_config_frozen_lockfile: string;
	export const GIT_PAGER: string;
	export const VSCODE_GIT_IPC_HANDLE: string;
	export const CONDA_SHLVL: string;
	export const DISPLAY: string;
	export const LMOD_ROOT: string;
	export const GSK_RENDERER: string;
	export const npm_lifecycle_event: string;
	export const SHLVL: string;
	export const BASH_ENV: string;
	export const LMOD_sys: string;
	export const QT_IM_MODULE: string;
	export const npm_config_user_agent: string;
	export const PNPM_SCRIPT_SRC_DIR: string;
	export const npm_execpath: string;
	export const FC_FONTATIONS: string;
	export const CONDA_PYTHON_EXE: string;
	export const LC_CTYPE: string;
	export const XDG_RUNTIME_DIR: string;
	export const NODE_PATH: string;
	export const PYENV_ROOT: string;
	export const DEBUGINFOD_URLS: string;
	export const npm_package_json: string;
	export const DEBUGINFOD_IMA_CERT_PATH: string;
	export const LC_ALL: string;
	export const VSCODE_GIT_ASKPASS_MAIN: string;
	export const JOURNAL_STREAM: string;
	export const XDG_DATA_DIRS: string;
	export const GDK_BACKEND: string;
	export const PATH: string;
	export const npm_config_node_gyp: string;
	export const MODULEPATH: string;
	export const GDMSESSION: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const LMOD_CMD: string;
	export const npm_config_registry: string;
	export const WASMER_CACHE_DIR: string;
	export const OMF_CONFIG: string;
	export const GIO_LAUNCHED_DESKTOP_FILE_PID: string;
	export const npm_node_execpath: string;
	export const GIO_LAUNCHED_DESKTOP_FILE: string;
	export const npm_config_https_proxy: string;
	export const WASMER_DIR: string;
	export const TERM_PROGRAM: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		SHELL: string;
		npm_command: string;
		SESSION_MANAGER: string;
		COLORTERM: string;
		VSCODE_DEBUGPY_ADAPTER_ENDPOINTS: string;
		XDG_MENU_PREFIX: string;
		TERM_PROGRAM_VERSION: string;
		GTK_IM_MODULE: string;
		CONDA_EXE: string;
		npm_config_npm_globalconfig: string;
		FPATH: string;
		NODE: string;
		APPLICATIONS: string;
		SSH_AUTH_SOCK: string;
		npm_config_verify_deps_before_run: string;
		npm_config__jsr_registry: string;
		MEMORY_PRESSURE_WRITE: string;
		PYDEVD_DISABLE_FILE_VALIDATION: string;
		XMODIFIERS: string;
		DESKTOP_SESSION: string;
		SSH_AGENT_PID: string;
		NO_AT_BRIDGE: string;
		npm_config_globalconfig: string;
		LMOD_DIR: string;
		EDITOR: string;
		PWD: string;
		XDG_SESSION_DESKTOP: string;
		LOGNAME: string;
		XDG_SESSION_TYPE: string;
		MODULESHOME: string;
		MANPATH: string;
		npm_config_catalogs: string;
		PNPM_HOME: string;
		SYSTEMD_EXEC_PID: string;
		BUNDLED_DEBUGPY_PATH: string;
		OMF_PATH: string;
		npm_config_catalog: string;
		XAUTHORITY: string;
		VSCODE_GIT_ASKPASS_NODE: string;
		LIBCLANG_PATH: string;
		GJS_DEBUG_TOPICS: string;
		WINDOWPATH: string;
		VSCODE_INJECTION: string;
		GDM_LANG: string;
		HOME: string;
		USERNAME: string;
		LANG: string;
		XDG_CURRENT_DESKTOP: string;
		npm_package_version: string;
		WASMTIME_HOME: string;
		MEMORY_PRESSURE_WATCH: string;
		PYTHONSTARTUP: string;
		STARSHIP_SHELL: string;
		npm_config_proxy: string;
		LMOD_SETTARG_FULL_SUPPORT: string;
		DENO_INSTALL: string;
		GIT_ASKPASS: string;
		INVOCATION_ID: string;
		pnpm_config_verify_deps_before_run: string;
		LMOD_VERSION: string;
		MANAGERPID: string;
		INIT_CWD: string;
		CHROME_DESKTOP: string;
		STARSHIP_SESSION_KEY: string;
		npm_lifecycle_script: string;
		GJS_DEBUG_OUTPUT: string;
		MODULEPATH_ROOT: string;
		MOZ_GMP_PATH: string;
		UHD_IMAGES_DIR: string;
		VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
		VSCODE_PYTHON_AUTOACTIVATE_GUARD: string;
		XDG_SESSION_CLASS: string;
		LMOD_PKG: string;
		TERM: string;
		npm_package_name: string;
		PYTHON_BASIC_REPL: string;
		USER: string;
		npm_config_frozen_lockfile: string;
		GIT_PAGER: string;
		VSCODE_GIT_IPC_HANDLE: string;
		CONDA_SHLVL: string;
		DISPLAY: string;
		LMOD_ROOT: string;
		GSK_RENDERER: string;
		npm_lifecycle_event: string;
		SHLVL: string;
		BASH_ENV: string;
		LMOD_sys: string;
		QT_IM_MODULE: string;
		npm_config_user_agent: string;
		PNPM_SCRIPT_SRC_DIR: string;
		npm_execpath: string;
		FC_FONTATIONS: string;
		CONDA_PYTHON_EXE: string;
		LC_CTYPE: string;
		XDG_RUNTIME_DIR: string;
		NODE_PATH: string;
		PYENV_ROOT: string;
		DEBUGINFOD_URLS: string;
		npm_package_json: string;
		DEBUGINFOD_IMA_CERT_PATH: string;
		LC_ALL: string;
		VSCODE_GIT_ASKPASS_MAIN: string;
		JOURNAL_STREAM: string;
		XDG_DATA_DIRS: string;
		GDK_BACKEND: string;
		PATH: string;
		npm_config_node_gyp: string;
		MODULEPATH: string;
		GDMSESSION: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		LMOD_CMD: string;
		npm_config_registry: string;
		WASMER_CACHE_DIR: string;
		OMF_CONFIG: string;
		GIO_LAUNCHED_DESKTOP_FILE_PID: string;
		npm_node_execpath: string;
		GIO_LAUNCHED_DESKTOP_FILE: string;
		npm_config_https_proxy: string;
		WASMER_DIR: string;
		TERM_PROGRAM: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
