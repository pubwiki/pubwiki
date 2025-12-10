import type { Artifact } from './types';

export const mockArtifacts: Artifact[] = [
	{
		id: '1',
		owner_id: 'user_a',
		owner_name: 'User_A',
		title: 'Cyberpunk Neon City Generator',
		description: 'A PubECS recipe that generates a cyberpunk city layout with neon aesthetics. It produces a WorldConfig XML and Lua map data.',
		type: 'RECIPE',
		visibility: 'PUBLIC',
		version_hash: 'a1b2c3d4',
		version_tag: 'v1.2',
		stats: {
			views: 12500,
			stars: 1200,
			forks: 340,
			runs: 5600
		},
		lineage: {
			parent_recipe_ids: ['6', '7']
		},
		tags: ['Cyberpunk', 'Generator', 'City', 'Sci-Fi'],
		coverImage: 'https://placehold.co/800x400/222/fff?text=Cyberpunk+City',
		files: [
			{ id: 'f1', artifact_id: '1', path: 'src/main.lua', content: 'print("Hello City")', language: 'lua', size: 1024 },
			{ id: 'f2', artifact_id: '1', path: 'config/world.xml', content: '<world></world>', language: 'xml', size: 2048 },
			{ id: 'f3', artifact_id: '1', path: 'README.md', content: '# Cyberpunk City', language: 'markdown', size: 512 }
		],
		license: 'CC BY-NC-SA 4.0',
		created_at: new Date('2025-12-01'),
		updated_at: new Date('2025-12-08')
	},
	{
		id: '2',
		owner_id: 'user_b',
		owner_name: 'User_B',
		title: 'Neon Tokyo District',
		description: 'Generated using the Cyberpunk Neon City Generator. Features high density commercial zones.',
		type: 'GAME',
		visibility: 'PUBLIC',
		version_hash: 'e5f6g7h8',
		version_tag: 'v1.0',
		stats: {
			views: 3400,
			stars: 450,
			forks: 12,
			runs: 0
		},
		lineage: {
			parent_recipe_ids: ['1', '8', '9'],
			input_params: {
				theme: 'Neon Tokyo',
				density: 'High',
				rain: true
			}
		},
		tags: ['Cyberpunk', 'RPG', 'Open World'],
		coverImage: 'https://placehold.co/800x400/1a237e/fff?text=Neon+Tokyo',
		license: 'CC BY-NC-SA 4.0',
		created_at: new Date('2025-12-09'),
		updated_at: new Date('2025-12-09')
	},
	{
		id: '3',
		owner_id: 'user_c',
		owner_name: 'User_C',
		title: 'Slum District 9',
		description: 'A darker, grittier take on the cyberpunk city. Generated with low wealth settings.',
		type: 'GAME',
		visibility: 'PUBLIC',
		version_hash: 'i9j0k1l2',
		version_tag: 'v1.0',
		stats: {
			views: 1200,
			stars: 180,
			forks: 5,
			runs: 0
		},
		lineage: {
			parent_recipe_ids: ['1'],
			input_params: {
				theme: 'Slums',
				density: 'Medium',
				wealth: 'Low'
			}
		},
		tags: ['Cyberpunk', 'Dark', 'Survival'],
		coverImage: 'https://placehold.co/800x400/3e2723/fff?text=Slum+District',
		license: 'CC BY-NC-SA 4.0',
		created_at: new Date('2025-12-10'),
		updated_at: new Date('2025-12-10')
	},
	{
		id: '4',
		owner_id: 'user_d',
		owner_name: 'User_D',
		title: 'Cyberpunk City - Optimized',
		description: 'A fork of the original generator with optimized performance for mobile devices.',
		type: 'RECIPE',
		visibility: 'PUBLIC',
		version_hash: 'm3n4o5p6',
		version_tag: 'v1.0-mobile',
		stats: {
			views: 800,
			stars: 120,
			forks: 2,
			runs: 450
		},
		lineage: {
			parent_artifact_id: '1'
		},
		tags: ['Cyberpunk', 'Mobile', 'Optimization'],
		coverImage: 'https://placehold.co/800x400/006064/fff?text=Optimized+City',
		license: 'CC BY-NC-SA 4.0',
		created_at: new Date('2025-12-11'),
		updated_at: new Date('2025-12-11')
	},
	{
		id: '5',
		owner_id: 'user_e',
		owner_name: 'User_E',
		title: 'Steampunk City Generator',
		description: 'Similar to the Cyberpunk generator but with a Steampunk aesthetic. Uses similar logic.',
		type: 'RECIPE',
		visibility: 'PUBLIC',
		version_hash: 'q7r8s9t0',
		version_tag: 'v0.9',
		stats: {
			views: 5000,
			stars: 890,
			forks: 45,
			runs: 2100
		},
		lineage: {},
		tags: ['Steampunk', 'Generator', 'City', 'Fantasy'],
		coverImage: 'https://placehold.co/800x400/5d4037/fff?text=Steampunk+City',
		license: 'CC BY-NC-SA 4.0',
		created_at: new Date('2025-11-15'),
		updated_at: new Date('2025-11-20')
	},
	{
		id: '6',
		owner_id: 'user_f',
		owner_name: 'User_F',
		title: 'Neon Assets Pack',
		description: 'A collection of neon signs and building textures.',
		type: 'ASSET_PACK',
		visibility: 'PUBLIC',
		version_hash: 'u1v2w3x4',
		version_tag: 'v1.0',
		stats: {
			views: 2000,
			stars: 300,
			forks: 10,
			runs: 0
		},
		lineage: {},
		tags: ['Neon', 'Assets', 'Textures'],
		coverImage: 'https://placehold.co/800x400/ff00ff/fff?text=Neon+Assets',
		license: 'CC BY 4.0',
		created_at: new Date('2025-11-01'),
		updated_at: new Date('2025-11-01')
	},
	{
		id: '7',
		owner_id: 'user_g',
		owner_name: 'User_G',
		title: 'Core Ruleset',
		description: 'The fundamental rules for the game world simulation.',
		type: 'RECIPE',
		visibility: 'PUBLIC',
		version_hash: 'y5z6a7b8',
		version_tag: 'v2.0',
		stats: {
			views: 8000,
			stars: 1500,
			forks: 50,
			runs: 10000
		},
		lineage: {},
		tags: ['Rules', 'Core', 'Simulation'],
		coverImage: 'https://placehold.co/800x400/424242/fff?text=Core+Rules',
		license: 'MIT',
		created_at: new Date('2025-10-01'),
		updated_at: new Date('2025-10-15')
	},
	{
		id: '8',
		owner_id: 'user_h',
		owner_name: 'User_H',
		title: 'Japanese Localization Pack',
		description: 'Translations and cultural assets for Japanese settings.',
		type: 'ASSET_PACK',
		visibility: 'PUBLIC',
		version_hash: 'c9d0e1f2',
		version_tag: 'v1.1',
		stats: {
			views: 1500,
			stars: 200,
			forks: 5,
			runs: 0
		},
		lineage: {},
		tags: ['Localization', 'Japan', 'Language'],
		coverImage: 'https://placehold.co/800x400/b71c1c/fff?text=JP+Pack',
		license: 'CC BY 4.0',
		created_at: new Date('2025-11-25'),
		updated_at: new Date('2025-11-25')
	},
	{
		id: '9',
		owner_id: 'user_i',
		owner_name: 'User_I',
		title: 'Cyberpunk Character Models',
		description: '3D models for cyberpunk citizens and enemies.',
		type: 'ASSET_PACK',
		visibility: 'PUBLIC',
		version_hash: 'g3h4i5j6',
		version_tag: 'v1.0',
		stats: {
			views: 4000,
			stars: 600,
			forks: 20,
			runs: 0
		},
		lineage: {
			parent_recipe_ids: ['6'] // Depends on Neon Assets Pack for textures
		},
		tags: ['Models', 'Characters', '3D'],
		coverImage: 'https://placehold.co/800x400/00acc1/fff?text=Cyber+Chars',
		license: 'CC BY-NC 4.0',
		created_at: new Date('2025-11-10'),
		updated_at: new Date('2025-11-10')
	}
];

export const getArtifactById = (id: string): Artifact | undefined => {
	return mockArtifacts.find(a => a.id === id);
};

export const getArtifactsByRecipeId = (recipeId: string): Artifact[] => {
	return mockArtifacts.filter(a => a.lineage.parent_recipe_ids?.includes(recipeId));
};

export const getArtifactsByForkId = (artifactId: string): Artifact[] => {
	return mockArtifacts.filter(a => a.lineage.parent_artifact_id === artifactId);
};

export const getDependencies = (artifact: Artifact): Artifact[] => {
	const dependencies: Artifact[] = [];
	const visited = new Set<string>();

	const collect = (id: string) => {
		if (visited.has(id)) return;
		visited.add(id);

		const art = getArtifactById(id);
		if (art) {
			if (art.id !== artifact.id) {
				dependencies.push(art);
			}
			
			art.lineage.parent_recipe_ids?.forEach(collect);
			if (art.lineage.parent_artifact_id) {
				collect(art.lineage.parent_artifact_id);
			}
		}
	};

	artifact.lineage.parent_recipe_ids?.forEach(collect);
	if (artifact.lineage.parent_artifact_id) {
		collect(artifact.lineage.parent_artifact_id);
	}

	return dependencies;
};

