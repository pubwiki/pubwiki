<script lang="ts">
	/**
	 * Animated node graph visualization for the hero section
	 * Represents the visual node editor concept
	 */

	interface NodeConfig {
		id: string;
		type: 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS' | 'LOADER' | 'SANDBOX';
		label: string;
		x: number;
		y: number;
		color: string;
		delay: number;
	}

	const nodes: NodeConfig[] = [
		{ id: 'prompt1', type: 'PROMPT', label: 'Character', x: 60, y: 80, color: '#3b82f6', delay: 0 },
		{ id: 'prompt2', type: 'PROMPT', label: 'Setting', x: 60, y: 200, color: '#3b82f6', delay: 0.1 },
		{ id: 'input', type: 'INPUT', label: 'User Input', x: 220, y: 140, color: '#8b5cf6', delay: 0.2 },
		{ id: 'generated', type: 'GENERATED', label: 'AI Response', x: 380, y: 140, color: '#22c55e', delay: 0.3 },
		{ id: 'vfs', type: 'VFS', label: 'Game Files', x: 60, y: 320, color: '#f59e0b', delay: 0.15 },
		{ id: 'loader', type: 'LOADER', label: 'Lua Service', x: 220, y: 320, color: '#06b6d4', delay: 0.25 },
		{ id: 'sandbox', type: 'SANDBOX', label: 'Preview', x: 380, y: 280, color: '#ec4899', delay: 0.35 }
	];

	interface Connection {
		from: string;
		to: string;
		fromX: number;
		fromY: number;
		toX: number;
		toY: number;
	}

	const connections: Connection[] = [
		{ from: 'prompt1', to: 'input', fromX: 160, fromY: 100, toX: 220, toY: 150 },
		{ from: 'prompt2', to: 'input', fromX: 160, fromY: 220, toX: 220, toY: 170 },
		{ from: 'input', to: 'generated', fromX: 320, fromY: 160, toX: 380, toY: 160 },
		{ from: 'vfs', to: 'loader', fromX: 160, fromY: 340, toX: 220, toY: 340 },
		{ from: 'loader', to: 'sandbox', fromX: 320, fromY: 340, toX: 380, toY: 310 },
		{ from: 'generated', to: 'sandbox', fromX: 430, fromY: 180, toX: 430, toY: 280 }
	];

	function getNodeIcon(type: string): string {
		switch (type) {
			case 'PROMPT':
				return 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z';
			case 'INPUT':
				return 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z';
			case 'GENERATED':
				return 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z';
			case 'VFS':
				return 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z';
			case 'LOADER':
				return 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4';
			case 'SANDBOX':
				return 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
			default:
				return '';
		}
	}
</script>

<div class="relative w-full aspect-square max-w-lg mx-auto">
	<!-- Background glow -->
	<div class="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-green-500/10 rounded-3xl blur-2xl"></div>

	<!-- SVG Canvas -->
	<svg viewBox="0 0 500 420" class="w-full h-full relative z-10">
		<defs>
			<!-- Gradient for connections -->
			<linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
				<stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.5" />
				<stop offset="100%" stop-color="#22c55e" stop-opacity="0.5" />
			</linearGradient>

			<!-- Glow filter -->
			<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="3" result="coloredBlur" />
				<feMerge>
					<feMergeNode in="coloredBlur" />
					<feMergeNode in="SourceGraphic" />
				</feMerge>
			</filter>

			<!-- Drop shadow -->
			<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
				<feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.1" />
			</filter>
		</defs>

		<!-- Connection Lines with Animation -->
		{#each connections as conn, i}
			<path
				d="M {conn.fromX} {conn.fromY} C {(conn.fromX + conn.toX) / 2} {conn.fromY}, {(conn.fromX + conn.toX) / 2} {conn.toY}, {conn.toX} {conn.toY}"
				fill="none"
				stroke="url(#connectionGradient)"
				stroke-width="2"
				stroke-dasharray="200"
				stroke-dashoffset="200"
				class="animate-draw-line"
				style="animation-delay: {0.5 + i * 0.1}s"
			/>
			<!-- Animated dot on connection -->
			<circle r="4" fill="#8b5cf6" opacity="0.8">
				<animateMotion
					dur="3s"
					repeatCount="indefinite"
					begin="{1 + i * 0.2}s"
				>
					<mpath href="#path-{i}" />
				</animateMotion>
			</circle>
			<path
				id="path-{i}"
				d="M {conn.fromX} {conn.fromY} C {(conn.fromX + conn.toX) / 2} {conn.fromY}, {(conn.fromX + conn.toX) / 2} {conn.toY}, {conn.toX} {conn.toY}"
				fill="none"
				stroke="none"
			/>
		{/each}

		<!-- Nodes -->
		{#each nodes as node}
			<g
				class="animate-fade-in-up cursor-pointer hover:scale-105 transition-transform"
				style="animation-delay: {node.delay}s; transform-origin: {node.x + 50}px {node.y + 20}px"
			>
				<!-- Node background -->
				<rect
					x={node.x}
					y={node.y}
					width="100"
					height="40"
					rx="8"
					fill="white"
					filter="url(#shadow)"
					class="stroke-1"
					stroke={node.color}
					stroke-opacity="0.3"
				/>

				<!-- Node header bar -->
				<rect
					x={node.x}
					y={node.y}
					width="100"
					height="12"
					rx="8"
					fill={node.color}
				/>
				<rect
					x={node.x}
					y={node.y + 8}
					width="100"
					height="4"
					fill={node.color}
				/>

				<!-- Node icon -->
				<svg x={node.x + 8} y={node.y + 16} width="16" height="16" viewBox="0 0 24 24">
					<path
						d={getNodeIcon(node.type)}
						fill="none"
						stroke={node.color}
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>

				<!-- Node label -->
				<text
					x={node.x + 30}
					y={node.y + 28}
					font-size="11"
					fill="#24292f"
					font-weight="500"
				>
					{node.label}
				</text>

				<!-- Connection handles -->
				<circle cx={node.x} cy={node.y + 20} r="4" fill="white" stroke={node.color} stroke-width="2" />
				<circle cx={node.x + 100} cy={node.y + 20} r="4" fill="white" stroke={node.color} stroke-width="2" />
			</g>
		{/each}

		<!-- Floating particles -->
		{#each Array(8) as _, i}
			<circle
				cx={80 + i * 50}
				cy={50 + (i % 3) * 100}
				r="2"
				fill="#8b5cf6"
				opacity="0.4"
				class="animate-float"
				style="animation-delay: {i * 0.3}s"
			/>
		{/each}
	</svg>
</div>

<style>
	@keyframes draw-line {
		to {
			stroke-dashoffset: 0;
		}
	}

	.animate-draw-line {
		animation: draw-line 1s ease-out forwards;
	}
</style>
