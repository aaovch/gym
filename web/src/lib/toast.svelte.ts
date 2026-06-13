export type ToastKind = 'success' | 'error' | 'info';

export type ToastAction = {
	label: string;
	run: () => void | Promise<void>;
};

export type Toast = {
	id: string;
	kind: ToastKind;
	message: string;
	action?: ToastAction;
};

class ToastStore {
	items = $state<Toast[]>([]);
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	private push(kind: ToastKind, message: string, action?: ToastAction, timeout = 4000) {
		const id =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random()}`;
		this.items = [...this.items, { id, kind, message, action }];
		if (timeout > 0) {
			const handle = setTimeout(() => this.dismiss(id), timeout);
			this.timers.set(id, handle);
		}
		return id;
	}

	success(message: string, action?: ToastAction) {
		return this.push('success', message, action);
	}

	error(message: string, action?: ToastAction) {
		return this.push('error', message, action, 6000);
	}

	info(message: string, action?: ToastAction) {
		return this.push('info', message, action);
	}

	/** Toast with an undo action gets a longer lifetime so it can actually be used. */
	undo(message: string, run: () => void | Promise<void>) {
		return this.push('info', message, { label: 'Отменить', run }, 7000);
	}

	dismiss(id: string) {
		const handle = this.timers.get(id);
		if (handle) {
			clearTimeout(handle);
			this.timers.delete(id);
		}
		this.items = this.items.filter((item) => item.id !== id);
	}

	async runAction(id: string) {
		const toast = this.items.find((item) => item.id === id);
		this.dismiss(id);
		if (toast?.action) await toast.action.run();
	}
}

export const toasts = new ToastStore();
