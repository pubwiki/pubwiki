// Bootstrap WikiFarm Vue app via ResourceLoader packageFiles (no bundling)
const { createApp } = require( 'vue' );
const App = require( './App.vue' );

( function () {
	const mount = () => {
		const rootEl = document.getElementById( 'wikifarm-app' );
		if ( !rootEl ) {
			return;
		}
		const app = createApp( App );
		app.mount( '#wikifarm-app' );
	};

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', mount );
	} else {
		mount();
	}
}() );
