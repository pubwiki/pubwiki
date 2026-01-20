/**
 * PubWiki Confirmation Store
 * 
 * 用于 controller 层与 UI 层之间的确认弹窗通信
 * 支持调用者传入自定义表单组件
 */

import type { Component } from 'svelte';

export type ConfirmationType = 'publish' | 'uploadArticle';

/** 表单组件的 Props 接口 */
export interface FormComponentProps {
	initialValues: Record<string, unknown>;
	onValuesChange: (values: Record<string, unknown>) => void;
}

export interface PendingConfirmation {
	id: string;
	type: ConfirmationType;
	/** 调用者传入的表单组件 */
	formComponent: Component<FormComponentProps>;
	/** 字段初始值 */
	initialValues: Record<string, unknown>;
	/** 确认时返回编辑后的值，取消时返回 null */
	resolve: (editedValues: Record<string, unknown> | null) => void;
}

let pendingConfirmation = $state<PendingConfirmation | null>(null);
let nextId = 1;

/**
 * 获取当前待确认的操作（用于 UI 层）
 */
export function getPendingConfirmation(): PendingConfirmation | null {
	return pendingConfirmation;
}

/**
 * 请求用户确认（用于 controller 层）
 * @param type 操作类型
 * @param formComponent 自定义表单组件
 * @param initialValues 字段初始值
 * @returns Promise，用户确认返回编辑后的值，取消返回 null
 */
export function requestConfirmation(
	type: ConfirmationType,
	formComponent: Component<FormComponentProps>,
	initialValues: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const id = `confirm-${nextId++}`;
		pendingConfirmation = {
			id,
			type,
			formComponent,
			initialValues,
			resolve: (editedValues: Record<string, unknown> | null) => {
				pendingConfirmation = null;
				resolve(editedValues);
			}
		};
	});
}

/**
 * 用户响应确认（用于 UI 层）
 * @param editedValues 用户编辑后的值，取消时传入 null
 */
export function respondConfirmation(editedValues: Record<string, unknown> | null): void {
	if (pendingConfirmation) {
		pendingConfirmation.resolve(editedValues);
	}
}
