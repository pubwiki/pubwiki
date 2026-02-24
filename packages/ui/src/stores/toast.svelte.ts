export interface Toast {
	id: string;
	message: string;
	type: 'info' | 'warning' | 'error' | 'success';
	duration?: number; // ms，默认 4000
}

class ToastStore {
	toasts = $state<Toast[]>([]);

	add(toast: Omit<Toast, 'id'>): string {
		const id = crypto.randomUUID();
		const duration = toast.duration ?? 4000;
		this.toasts.push({ id, duration, ...toast });
		setTimeout(() => this.remove(id), duration);
		return id;
	}

	remove(id: string): void {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	error(message: string): string {
		return this.add({ message, type: 'error' });
	}

	warn(message: string): string {
		return this.add({ message, type: 'warning' });
	}

	info(message: string): string {
		return this.add({ message, type: 'info' });
	}

	success(message: string): string {
		return this.add({ message, type: 'success' });
	}
}

export const toastStore = new ToastStore();