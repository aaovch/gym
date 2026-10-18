export function fmtNum(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

export function fmtSet(weight: number, reps: number): string {
	return `${fmtNum(weight)}×${fmtNum(reps)}`;
}

export function todayIso(date = new Date()): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDateRu(iso: string): string {
	const [y, m, d] = iso.split('-');
	return `${d}.${m}.${y}`;
}
