/**
 * 判断是否为文件
 */
export function isVfsFile(item) {
    return 'folderId' in item && 'size' in item;
}
/**
 * 判断是否为文件夹
 */
export function isVfsFolder(item) {
    return 'parentFolderId' in item && !('size' in item);
}
//# sourceMappingURL=file.js.map