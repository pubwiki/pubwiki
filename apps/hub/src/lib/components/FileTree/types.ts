/**
 * FileTree Types
 */

export interface FileItem {
	type: 'file' | 'folder';
	name: string;
	path: string;
	files?: FileItem[];
}

export interface ContextMenuState {
	visible: boolean;
	x: number;
	y: number;
	target: FileItem | null;
	targetType: 'file' | 'folder' | 'root';
}

export interface InlineEditState {
	active: boolean;
	type: 'new-file' | 'new-folder' | 'rename';
	parentPath: string;
	target?: FileItem;
	name: string;
}

/**
 * File operations interface for external handlers
 */
export interface FileOperations {
	/** Called when renaming a file/folder */
	onRename?: (oldPath: string, newPath: string) => Promise<void>;
	/** Called when deleting a file/folder */
	onDelete?: (path: string, isFolder: boolean) => Promise<void>;
	/** Called when creating a new file */
	onCreateFile?: (path: string) => Promise<void>;
	/** Called when creating a new folder */
	onCreateFolder?: (path: string) => Promise<void>;
	/** Called when moving a file/folder via drag-drop */
	onMove?: (oldPath: string, newPath: string) => Promise<void>;
	/** Called when uploading files - receives FileList with webkitRelativePath for folder structure */
	onUpload?: (files: FileList) => Promise<void>;
	/** Called when downloading all files as zip */
	onDownload?: () => Promise<void>;
}

/**
 * Convert flat file paths to a tree structure
 * @param paths - Array of file paths like ['src/index.ts', 'src/lib/utils.ts']
 * @returns FileItem[] tree structure
 */
export function buildTreeFromPaths(paths: string[]): FileItem[] {
	type TreeMap = Map<string, TreeMap | null>;
	const root: TreeMap = new Map();

	for (const path of paths) {
		const parts = path.split('/');
		let current: TreeMap = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isFile = i === parts.length - 1;

			if (!current.has(part)) {
				current.set(part, isFile ? null : new Map());
			}

			if (!isFile) {
				const next = current.get(part);
				if (next) current = next;
			}
		}
	}

	function mapToItems(map: TreeMap, parentPath: string = ''): FileItem[] {
		const items: FileItem[] = [];

		// Sort: folders first, then files, alphabetically within each group
		const entries = Array.from(map.entries()).sort(([aName, aVal], [bName, bVal]) => {
			const aIsFolder = aVal !== null;
			const bIsFolder = bVal !== null;
			if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
			return aName.localeCompare(bName);
		});

		for (const [name, value] of entries) {
			const path = parentPath ? `${parentPath}/${name}` : name;
			
			if (value === null) {
				// It's a file
				items.push({ type: 'file', name, path });
			} else {
				// It's a folder
				items.push({
					type: 'folder',
					name,
					path,
					files: mapToItems(value, path)
				});
			}
		}

		return items;
	}

	return mapToItems(root);
}
