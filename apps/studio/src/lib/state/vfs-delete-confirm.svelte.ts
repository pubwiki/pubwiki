/**
 * VFS Delete Confirmation State
 * 
 * 用于在删除 VFS 节点时请求用户确认
 * 因为删除 VFS 节点会同时删除底层 OPFS 中的所有文件数据
 */

import type { Node } from '@xyflow/svelte';
import type { FlowNodeData } from '$lib/types';

export interface VfsDeleteConfirmation {
	/** 待删除的 VFS 节点 */
	vfsNodes: Node<FlowNodeData>[];
	/** 其他待删除的节点（不需要确认） */
	otherNodes: Node<FlowNodeData>[];
	/** 确认回调 */
	resolve: (confirmed: boolean) => void;
}

let pendingConfirmation = $state<VfsDeleteConfirmation | null>(null);

/**
 * 获取当前待确认的删除操作（用于 UI 层）
 */
export function getPendingVfsDeleteConfirmation(): VfsDeleteConfirmation | null {
	return pendingConfirmation;
}

/**
 * 请求用户确认删除 VFS 节点
 * @param vfsNodes 待删除的 VFS 节点
 * @param otherNodes 其他待删除的节点
 * @returns Promise，用户确认返回 true，取消返回 false
 */
export function requestVfsDeleteConfirmation(
	vfsNodes: Node<FlowNodeData>[],
	otherNodes: Node<FlowNodeData>[]
): Promise<boolean> {
	return new Promise((resolve) => {
		pendingConfirmation = {
			vfsNodes,
			otherNodes,
			resolve: (confirmed: boolean) => {
				pendingConfirmation = null;
				resolve(confirmed);
			}
		};
	});
}

/**
 * 响应确认请求（用于 UI 层）
 * @param confirmed 用户是否确认
 */
export function respondVfsDeleteConfirmation(confirmed: boolean): void {
	if (pendingConfirmation) {
		pendingConfirmation.resolve(confirmed);
	}
}
