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
		lineage: {},
		tags: ['Cyberpunk', 'Generator', 'City', 'Sci-Fi'],
		coverImage: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&h=400&fit=crop',
		files: [
			{ id: 'f1', artifact_id: '1', path: 'src/main.lua', content: 'print("Hello City")', language: 'lua', size: 1024 },
			{ id: 'f2', artifact_id: '1', path: 'config/world.xml', content: '<world></world>', language: 'xml', size: 2048 },
			{ id: 'f3', artifact_id: '1', path: 'README.md', content: '# Cyberpunk City', language: 'markdown', size: 512 }
		],
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
			parent_recipe_ids: ['1'],
			input_params: {
				theme: 'Neon Tokyo',
				density: 'High',
				rain: true
			}
		},
		tags: ['Cyberpunk', 'RPG', 'Open World'],
		coverImage: 'https://images.unsplash.com/photo-1572435026915-0f447188e121?w=800&h=400&fit=crop',
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
		coverImage: 'https://images.unsplash.com/photo-1605806616949-1e87b487bc2a?w=800&h=400&fit=crop',
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
		coverImage: 'https://images.unsplash.com/photo-1515630278258-407f66498911?w=800&h=400&fit=crop',
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
		coverImage: 'https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?w=800&h=400&fit=crop',
		created_at: new Date('2025-11-15'),
		updated_at: new Date('2025-11-20')
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

export const getRelatedArtifacts = (artifact: Artifact): Artifact[] => {
	// Simple mock logic: find artifacts with overlapping tags, excluding self
	return mockArtifacts.filter(a => 
		a.id !== artifact.id && 
		a.tags.some(tag => artifact.tags.includes(tag))
	).slice(0, 3);
};

