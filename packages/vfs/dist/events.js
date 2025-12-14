/**
 * VFS 事件总线
 *
 * 提供文件系统事件的发布/订阅功能。
 */
export class VfsEventBus {
    listeners = new Map();
    /**
     * 订阅特定类型的事件
     * @param eventType 事件类型
     * @param handler 事件处理函数
     * @returns 取消订阅函数
     */
    on(eventType, handler) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(handler);
        return () => this.off(eventType, handler);
    }
    /**
     * 订阅一次性事件
     * @param eventType 事件类型
     * @param handler 事件处理函数
     * @returns 取消订阅函数
     */
    once(eventType, handler) {
        const wrapper = async (event) => {
            this.off(eventType, wrapper);
            await handler(event);
        };
        return this.on(eventType, wrapper);
    }
    /**
     * 取消订阅
     * @param eventType 事件类型
     * @param handler 事件处理函数
     */
    off(eventType, handler) {
        const handlers = this.listeners.get(eventType);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.listeners.delete(eventType);
            }
        }
    }
    /**
     * 订阅所有事件
     * @param handler 事件处理函数
     * @returns 取消订阅函数
     */
    onAny(handler) {
        const eventTypes = [
            'file:created',
            'file:updated',
            'file:deleted',
            'file:moved',
            'folder:created',
            'folder:updated',
            'folder:deleted',
            'folder:moved',
        ];
        const unsubscribers = eventTypes.map((type) => this.on(type, handler));
        return () => unsubscribers.forEach((unsub) => unsub());
    }
    /**
     * 发射事件
     * @param event 事件对象
     */
    async emit(event) {
        const handlers = this.listeners.get(event.type);
        if (handlers && handlers.size > 0) {
            const promises = Array.from(handlers).map((handler) => Promise.resolve()
                .then(() => handler(event))
                .catch((err) => {
                console.error(`[VfsEventBus] Error in handler for "${event.type}":`, err);
            }));
            await Promise.all(promises);
        }
    }
    /**
     * 清除所有监听器
     */
    clear() {
        this.listeners.clear();
    }
    /**
     * 清理资源
     */
    dispose() {
        this.clear();
    }
}
//# sourceMappingURL=events.js.map