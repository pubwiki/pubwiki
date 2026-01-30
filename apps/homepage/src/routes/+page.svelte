<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import Hero from '$lib/components/Hero.svelte';
	import Features from '$lib/components/Features.svelte';
	import HowItWorks from '$lib/components/HowItWorks.svelte';
	import Showcase from '$lib/components/Showcase.svelte';
	import CTA from '$lib/components/CTA.svelte';
	import Footer from '$lib/components/Footer.svelte';
</script>

<div class="min-h-screen">
	<Header />
	<main>
		<Hero />
		<Features />
		<HowItWorks />
		<Showcase />
		<CTA />
	</main>
	<Footer />
</div>
