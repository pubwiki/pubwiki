/**
 * 检查 Provider 是否支持版本控制
 */
export function isVersionedProvider(provider) {
    return ('commit' in provider &&
        'getHistory' in provider &&
        'checkout' in provider &&
        'diff' in provider &&
        'revert' in provider);
}
//# sourceMappingURL=versioned-vfs-provider.js.map