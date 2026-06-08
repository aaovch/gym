export function fmtNum(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

export function fmtSet(weight: number, reps: number): string {
	return `${fmtNum(weight)}×${fmtNum(reps)}`;
}

export function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export function formatDateRu(iso: string): string {
	const [y, m, d] = iso.split('-');
	return `${d}.${m}.${y}`;
}
