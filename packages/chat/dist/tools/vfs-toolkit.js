/**
 * VFS Toolkit - File operation tools for function calling
 *
 * Provides a toolkit that can be registered with PubChat
 * to enable file operation capabilities when a Vfs instance is available.
 */
import { z } from 'zod';
/**
 * Register VFS tools to a tool registry
 *
 * @param registry Tool registry to register tools to
 * @param vfs Vfs instance from @pubwiki/vfs
 */
export function registerVFSTools(registry, vfs) {
    // read_file tool
    registry.register('read_file', 'Read the content of a file at the specified path. Returns the file content as a string.', z.object({
        path: z.string().describe('The path of the file to read')
    }), async (args) => {
        const { path } = args;
        try {
            const file = await vfs.readFile(path);
            let content;
            if (typeof file.content === 'string') {
                content = file.content;
            }
            else if (file.content instanceof ArrayBuffer) {
                content = new TextDecoder().decode(file.content);
            }
            else {
                return { success: false, error: 'File content not available' };
            }
            return { success: true, content };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to read file'
            };
        }
    });
    // write_file tool
    registry.register('write_file', 'Write content to a file at the specified path. Creates the file if it does not exist, overwrites if it does.', z.object({
        path: z.string().describe('The path of the file to write'),
        content: z.string().describe('The content to write to the file')
    }), async (args) => {
        const { path, content } = args;
        try {
            const exists = await vfs.exists(path);
            if (exists) {
                await vfs.updateFile(path, content);
            }
            else {
                await vfs.createFile(path, content);
            }
            return { success: true, path, bytesWritten: content.length };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to write file'
            };
        }
    });
    // delete_file tool
    registry.register('delete_file', 'Delete a file at the specified path.', z.object({
        path: z.string().describe('The path of the file to delete')
    }), async (args) => {
        const { path } = args;
        try {
            await vfs.deleteFile(path);
            return { success: true, path };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete file'
            };
        }
    });
    // list_dir tool
    registry.register('list_dir', 'List the contents of a directory at the specified path. Returns an array of entries with name and isDirectory flag.', z.object({
        path: z.string().describe('The path of the directory to list')
    }), async (args) => {
        const { path } = args;
        try {
            const items = await vfs.listFolder(path);
            const entries = items.map((item) => ({
                name: item.name,
                isDirectory: 'parentFolderId' in item && !('size' in item)
            }));
            return { success: true, entries };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list directory'
            };
        }
    });
    // mkdir tool
    registry.register('mkdir', 'Create a directory at the specified path.', z.object({
        path: z.string().describe('The path of the directory to create')
    }), async (args) => {
        const { path } = args;
        try {
            await vfs.createFolder(path);
            return { success: true, path };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create directory'
            };
        }
    });
    // rmdir tool
    registry.register('rmdir', 'Remove a directory at the specified path. Use recursive option to remove non-empty directories.', z.object({
        path: z.string().describe('The path of the directory to remove'),
        recursive: z.boolean().optional().describe('If true, removes the directory and all its contents')
    }), async (args) => {
        const { path, recursive } = args;
        try {
            await vfs.deleteFolder(path, recursive);
            return { success: true, path };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to remove directory'
            };
        }
    });
    // file_exists tool
    registry.register('file_exists', 'Check if a file or directory exists at the specified path.', z.object({
        path: z.string().describe('The path to check')
    }), async (args) => {
        const { path } = args;
        try {
            const exists = await vfs.exists(path);
            return { path, exists };
        }
        catch (error) {
            return {
                path,
                exists: false,
                error: error instanceof Error ? error.message : 'Failed to check path'
            };
        }
    });
    // file_stat tool
    registry.register('file_stat', 'Get information about a file or directory at the specified path.', z.object({
        path: z.string().describe('The path to get information about')
    }), async (args) => {
        const { path } = args;
        try {
            const stat = await vfs.stat(path);
            return {
                success: true,
                path,
                size: stat.size,
                isFile: stat.isFile,
                isDirectory: stat.isDirectory,
                createdAt: stat.createdAt.toISOString(),
                updatedAt: stat.updatedAt.toISOString()
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get file info'
            };
        }
    });
}
/**
 * Get VFS tool definitions without registering handlers
 *
 * Useful for previewing what tools would be registered
 */
export function getVFSToolDefinitions() {
    return [
        {
            name: 'read_file',
            description: 'Read the content of a file at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path of the file to read' }
                },
                required: ['path']
            }
        },
        {
            name: 'write_file',
            description: 'Write content to a file at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path of the file to write' },
                    content: { type: 'string', description: 'The content to write to the file' }
                },
                required: ['path', 'content']
            }
        },
        {
            name: 'delete_file',
            description: 'Delete a file at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path of the file to delete' }
                },
                required: ['path']
            }
        },
        {
            name: 'list_dir',
            description: 'List the contents of a directory at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path of the directory to list' }
                },
                required: ['path']
            }
        },
        {
            name: 'mkdir',
            description: 'Create a directory at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path of the directory to create' }
                },
                required: ['path']
            }
        },
        {
            name: 'rmdir',
            description: 'Remove a directory at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path of the directory to remove' },
                    recursive: { type: 'boolean', description: 'If true, removes the directory and all its contents' }
                },
                required: ['path']
            }
        },
        {
            name: 'file_exists',
            description: 'Check if a file or directory exists at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path to check' }
                },
                required: ['path']
            }
        },
        {
            name: 'file_stat',
            description: 'Get information about a file or directory at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path to get information about' }
                },
                required: ['path']
            }
        }
    ];
}
//# sourceMappingURL=vfs-toolkit.js.map