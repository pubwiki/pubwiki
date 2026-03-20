<script>
	// Coming Soon page - light theme with header
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Coming Soon - Pub.Wiki</title>
	<meta name="description" content="Something exciting is coming soon." />
</svelte:head>

<!-- Header -->
<header class="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/50">
	<div style="padding-left: 2rem; padding-right: 2rem;">
		<div class="flex h-16 items-center">
			<!-- Logo -->
			<a href={resolve('/')} class="flex items-center gap-2 font-bold text-xl">
				<svg class="h-8 w-8" viewBox="0 0 163.9 185.36" xmlns="http://www.w3.org/2000/svg">
					<path
						fill="#1e293b"
						d="M90.79.92l15.3-.42c1.01-.03,1.94.42,2.46,1.15,1.31,1.86,3.92,5.34,6.07,5.99,1.09.33,2.02.94,2.5,1.82l15.06,27.38c.12.23.27.45.46.66l27.79,37.35c.49.54.75,1.19.75,1.87l2.22,54.54c0,2.52-1.1,4.95-3.09,6.83l-32.55,28.58c-5.97,5.66-14,9.5-22.84,10.94l-57.24,6.94c-1.33.22-2.68.32-4.03.32H9.93c-1.3,0-2.59-.16-3.83-.47h0c-3.41-.86-5.74-3.5-5.58-6.37l.04-107.06L37.31,22.76,90.79.92Z"
					/>
					<path
						fill="#94a3b8"
						d="M84.69,8.73c-1.2,1.11-5.65,3.68-5.65,3.68-.85.53-3.16,1.02-4.13,1.39l-5.64,1.79c-.73.23-1.43.51-2.1.84l-5.58,2.76c-.85.42-1.62.92-2.32,1.49-1.57,1.29-4.52,3.62-5.61,3.89-8.12,1.99-2.71.37-8.91,4.42-10.57,6.92-28.61,21.97-38.49,35.21-1.26,1.69-5.74,6.38-5.74,6.38l-.02-28.36c0-1.52.66-2.98,1.85-4.12l15.87-13.94c.42-.45,28.82-14.47,29.46-14.67l26.34-7c.36-.11.75-.17,1.14-.18l15.44-1.38s-4.05,6.08-5.9,7.79Z"
					/>
					<g fill="#ffffff">
						<path d="M24.63,79.96h21.21c4.79,0,8.44.91,10.97,2.73,2.52,1.82,3.78,4.21,3.78,7.15s-1.16,5.19-3.48,6.74c-3.19,2.13-7.13,3.2-11.81,3.2h-7.66v12.33c0,.72.2,1.23.61,1.54.54.39,1.27.59,2.18.59h4.88v1.83h-20.67v-1.83h4.32c.86,0,1.48-.14,1.88-.43.4-.28.6-.67.6-1.16v-28.78c0-.73-.25-1.26-.76-1.59-.51-.33-1.46-.49-2.86-.49h-3.18v-1.83ZM37.62,98h5.83c3.69,0,6.36-.65,7.99-1.94,1.63-1.29,2.45-3.43,2.45-6.41,0-2.08-.37-3.68-1.1-4.8-.73-1.11-1.81-1.94-3.23-2.48-1.42-.54-3.76-.81-7.01-.81-2.15,0-3.51.17-4.08.51s-.86.94-.86,1.78v14.14Z" />
						<path d="M73.31,92.77v15.16c0,1.86.56,3.29,1.67,4.3,1.11,1.01,2.55,1.51,4.31,1.51,2.17,0,4.01-.74,5.52-2.21,1.52-1.47,2.28-3.32,2.28-5.53v-8.57c0-.78-.33-1.39-1-1.82-.67-.43-1.95-.67-3.85-.72v-1.71l9.56-.42v18.77c0,.86.29,1.53.87,1.99.58.46,1.4.7,2.44.7h1.71v1.64l-9.16.17-.58-4.49c-1.63,1.61-3.26,2.82-4.9,3.64-1.64.81-3.31,1.22-4.99,1.22-2.46,0-4.52-.69-6.18-2.08-1.68-1.37-2.52-3.69-2.52-6.96v-9.94c0-.88-.42-1.55-1.25-2-.58-.33-1.77-.5-3.58-.54v-1.71l9.65-.42Z" />
						<path d="M108.77,79.54v17.01c1.14-1.36,2.41-2.37,3.81-3.04,1.39-.67,2.92-1.01,4.56-1.01,3.2,0,5.9,1.05,8.11,3.15s3.31,4.87,3.31,8.3c0,3.73-1.19,6.73-3.56,9.02-2.37,2.29-5.31,3.43-8.82,3.43-1.67,0-3.18-.28-4.53-.83-1.36-.55-2.75-1.49-4.19-2.81-1.1,1.48-2.17,2.69-3.2,3.64l-1.16-.34c.54-1.87.81-3.82.81-5.86v-25.85c0-.8-.33-1.42-1-1.88-.67-.46-1.61-.68-2.83-.68h-1.22v-1.83l9.91-.42ZM116.09,94.68c-2.19,0-3.97.8-5.35,2.4-1.38,1.6-2.06,4.25-2.06,7.94s.68,6.02,2.03,7.53c1.36,1.51,3.13,2.27,5.32,2.27,1.98,0,3.56-.75,4.77-2.24,1.51-1.89,2.27-4.58,2.27-8.07s-.66-5.95-1.99-7.5c-1.33-1.55-2.99-2.33-4.98-2.33Z" />
					</g>
				</svg>
				<span class="text-slate-800">Pub.Wiki</span>
			</a>
		</div>
	</div>
</header>

<main class="relative h-screen w-screen flex items-center justify-center overflow-hidden bg-gradient-to-b from-slate-50 to-white">
	<!-- Background gradient orbs -->
	<div
		class="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-amber-400/40 animate-float animate-pulse-glow"
	></div>
	<div
		class="absolute bottom-[-30%] right-[-10%] w-[700px] h-[700px] rounded-full bg-violet-400/30 animate-float animate-pulse-glow"
		style="animation-delay: -3s;"
	></div>
	<div
		class="absolute top-[30%] right-[20%] w-[400px] h-[400px] rounded-full bg-pink-400/25 animate-float animate-pulse-glow"
		style="animation-delay: -7s;"
	></div>
	<div
		class="absolute bottom-[20%] left-[15%] w-[350px] h-[350px] rounded-full bg-cyan-400/25 animate-float animate-pulse-glow"
		style="animation-delay: -12s;"
	></div>

	<!-- Main content -->
	<div class="z-10 text-center px-6">
		<h1
			class="gradient-text text-5xl sm:text-6xl md:text-8xl lg:text-9xl font-extrabold tracking-tight select-none leading-relaxed whitespace-nowrap"
		>
			Coming Soon
		</h1>
		<p class="mt-6 text-lg sm:text-xl md:text-2xl text-slate-600 font-medium max-w-3xl mx-auto">
			The official site is under construction, but you can have a try
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external URL -->
			<a
				href="https://try.pub.wiki"
				class="text-violet-600 hover:text-violet-800 underline underline-offset-4 transition-colors"
				>here</a
			>.
		</p>
	</div>
</main>
