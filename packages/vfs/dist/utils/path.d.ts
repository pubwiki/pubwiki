/**
 * 从文件名和文件夹路径构建完整路径
 */
export declare function buildFilePath(folderPath: string | null, fileName: string): string;
/**
 * 从完整路径提取文件名
 */
export declare function getFileName(path: string): string;
/**
 * 从完整路径提取文件夹路径
 */
export declare function getFolderPath(path: string): string;
/**
 * 规范化路径
 */
export declare function normalizePath(path: string): string;
/**
 * 合并路径段
 */
export declare function joinPaths(...paths: string[]): string;
/**
 * 检查路径是否为根路径
 */
export declare function isRootPath(path: string): boolean;
/**
 * 获取父路径
 */
export declare function getParentPath(path: string): string;
/**
 * 检查路径是否是另一个路径的子路径
 */
export declare function isSubPath(path: string, parentPath: string): boolean;
/**
 * 获取文件扩展名
 */
export declare function getFileExtension(path: string): string;
/**
 * 获取不带扩展名的文件名
 */
export declare function getFileBaseName(path: string): string;
/**
 * 获取相对路径
 */
export declare function getRelativePath(path: string, basePath: string): string;
//# sourceMappingURL=path.d.ts.map