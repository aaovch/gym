import type { WorkoutEntry } from './types';

export function epley1rm(weight: number, reps: number): number {
	return weight * (1 + reps / 30);
}

export type Best1rmHit = {
	value: number;
	weight: number;
	reps: number;
	date: string;
};

function best1rmFromEntries(
	entries: WorkoutEntry[],
	exercise: string,
	predicate: (date: string) => boolean
): Best1rmHit | null {
	let best: Best1rmHit | null = null;
	for (const entry of entries) {
		if (entry.exercise !== exercise || !predicate(entry.date)) continue;
		for (const [weight, reps] of entry.sets) {
			const value = epley1rm(weight, reps);
			if (!best || value > best.value) {
				best = {
					value: Math.round(value * 10) / 10,
					weight,
					reps,
					date: entry.date
				};
			}
		}
	}
	return best;
}

/** Лучший 1ПМ (Эпли) строго до даты (не включая день). */
export function best1rmBeforeDate(
	entries: WorkoutEntry[],
	exercise: string,
	beforeDate: string
): Best1rmHit | null {
	return best1rmFromEntries(entries, exercise, (date) => date < beforeDate);
}

/** Лучший 1ПМ в диапазоне дат включительно. */
export function best1rmInRange(
	entries: WorkoutEntry[],
	exercise: string,
	startDate: string,
	endDate: string
): Best1rmHit | null {
	return best1rmFromEntries(
		entries,
		exercise,
		(date) => date >= startDate && date <= endDate
	);
}

/** Лучший 1ПМ (Эпли) за всю историю упражнения. */
export function best1rmAllTime(entries: WorkoutEntry[], exercise: string): Best1rmHit | null {
	return best1rmFromEntries(entries, exercise, () => true);
}

export type MesoAnchorSource = 'prior' | 'in_meso' | 'manual';

export type MesoAnchor1rm = {
	value: number;
	source: MesoAnchorSource;
	/** Дата сета, из которого взят 1ПМ. */
	asOfDate: string | null;
};

/**
 * Якорь на старт мезоцикла:
 * 1) лучший 1ПМ до начала блока (включая прошлый мезо);
 * 2) если истории нет — лучший за текущий мезо (первый блок).
 */
export function resolveMesoAnchor1rm(
	entries: WorkoutEntry[],
	exercise: string,
	mesoStart: string,
	mesoEnd: string
): MesoAnchor1rm | null {
	const prior = best1rmBeforeDate(entries, exercise, mesoStart);
	if (prior) {
		return { value: prior.value, source: 'prior', asOfDate: prior.date };
	}
	const inMeso = best1rmInRange(entries, exercise, mesoStart, mesoEnd);
	if (inMeso) {
		return { value: inMeso.value, source: 'in_meso', asOfDate: inMeso.date };
	}
	return null;
}

export type ProtocolPhase = {
	id: string;
	label: string;
	/** Целевая интенсивность в % от 1ПМ (80 = 80% от 1ПМ). */
	intensityPct: number;
	/** Первый микроцикл фазы (1-based). */
	microFrom: number;
	/** Последний микроцикл фазы (1-based). */
	microTo: number;
};

export type ProtocolTemplate = {
	id: string;
	name: string;
	/** Краткое описание метода — дополняется по мере проработки протокола. */
	description?: string;
	phases: ProtocolPhase[];
};

function strengthMethodTemplate(
	id: string,
	name: string,
	intensityPct: number,
	description: string
): ProtocolTemplate {
	return {
		id,
		name,
		description,
		phases: [{ id: `${id}-work`, label: 'Рабочий', intensityPct, microFrom: 1, microTo: 12 }]
	};
}

/** Методы силовой подготовки — базовый каталог протоколов тренировки. */
export const MAX_EFFORT_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'max-effort',
	name: 'Метод максимальных усилий',
	description:
		'Работа на пределе: 90–100% 1ПМ, суммарно 2–10 повторений за тренировку. Раз в мезоцикл — для силы, теста и авторегуляции.',
	phases: [
		{ id: 'me-w1', label: 'Лёгкая · 3×5', intensityPct: 65, microFrom: 1, microTo: 1 },
		{ id: 'me-w2', label: 'Средняя · 5×5', intensityPct: 72.5, microFrom: 2, microTo: 2 },
		{ id: 'me-w3', label: 'Тяжёлая · 5×3', intensityPct: 80, microFrom: 3, microTo: 3 },
		{ id: 'me-w4', label: 'Тяжёлая · 3–5×3, 3ПМ', intensityPct: 90, microFrom: 4, microTo: 4 }
	]
};

export const REPEATED_EFFORT_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'repeated-effort',
	name: 'Метод повторных усилий',
	description:
		'Подмаксимальный объём: 55–70% 1ПМ, суммарно 24–80 повторений. Для доп. движений и периодов, где не мешает основным задачам.',
	phases: [
		{ id: 're-w1', label: 'Лёгкая · 4×12', intensityPct: 60, microFrom: 1, microTo: 1 },
		{ id: 're-w2', label: 'Средняя · 3×8 RIR-3', intensityPct: 60, microFrom: 2, microTo: 2 },
		{ id: 're-w3', label: 'Тяжёлая · 3×9', intensityPct: 62.5, microFrom: 3, microTo: 3 },
		{ id: 're-w4', label: 'Тяжёлая · 3×10', intensityPct: 65, microFrom: 4, microTo: 4 }
	]
};

export const SUBMAX_EFFORT_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'submax-effort',
	name: 'Метод субмаксимальных усилий',
	description:
		'Большие, но не предельные веса: 65–85% 1ПМ, суммарно 15–36 повторений. Приоритетный метод силы; сильным атлетам — в комбинации с другими.',
	phases: [
		{ id: 'sm-w1', label: 'Средняя · 3×5', intensityPct: 67.5, microFrom: 1, microTo: 1 },
		{ id: 'sm-w2', label: 'Средняя · 5×5', intensityPct: 70, microFrom: 2, microTo: 2 },
		{ id: 'sm-w3', label: 'Средняя · 5×5', intensityPct: 72.5, microFrom: 3, microTo: 3 },
		{ id: 'sm-w4', label: 'Тяжёлая · 5×5', intensityPct: 75, microFrom: 4, microTo: 4 }
	]
};

export function isBundledProtocolStub(template: ProtocolTemplate): boolean {
	return template.phases.length === 1 && template.phases[0].id === `${template.id}-work`;
}

export const DYNAMIC_EFFORT_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'dynamic-effort',
	name: 'Метод динамических усилий',
	description:
		'Взрывная работа: 55–65% 1ПМ (до 80%), суммарно 5–25 повторений, темп 11X1 / X1X1 / XXX1. Контроль скорости (VBT), резина/цепи 15–30%.',
	phases: [
		{ id: 'de-w1', label: 'Лёгкая · 8×3', intensityPct: 50, microFrom: 1, microTo: 1 },
		{ id: 'de-w2', label: 'Лёгкая · 10×2', intensityPct: 50, microFrom: 2, microTo: 2 },
		{ id: 'de-w3', label: 'Лёгкая · 10×2', intensityPct: 55, microFrom: 3, microTo: 3 },
		{ id: 'de-w4', label: 'Лёгкая · 10×2', intensityPct: 55, microFrom: 4, microTo: 4 }
	]
};

export const CLUSTER_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'cluster',
	name: 'Кластерный метод',
	description:
		'Повышенная интенсивность: 75–90% 1ПМ, 15–36 повторений, пауза между повторами в сете (~30 с). Раз в 2 недели или раз в мезоцикл.',
	phases: [
		{ id: 'cl-w1', label: 'Средняя · 5×5', intensityPct: 70, microFrom: 1, microTo: 1 },
		{ id: 'cl-w2', label: 'Средняя · 5×5 кластер', intensityPct: 75, microFrom: 2, microTo: 2 },
		{ id: 'cl-w3', label: 'Тяжёлая · 3×5', intensityPct: 80, microFrom: 3, microTo: 3 },
		{ id: 'cl-w4', label: 'Тяжёлая · 3×5 кластер', intensityPct: 85, microFrom: 4, microTo: 4 }
	]
};

export const ISOMETRIC_MAX_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'isometric-max',
	name: 'Изометрические максимальные усилия',
	description:
		'Статическое усилие 5–6 сек, 90–100% максимума, суммарно 9–15 «повторений». Динамометр повышает эффективность; можно применять часто.',
	phases: [
		{ id: 'im-w1', label: '3×3×5 сек', intensityPct: 90, microFrom: 1, microTo: 1 },
		{ id: 'im-w2', label: '3×3×5 сек', intensityPct: 92.5, microFrom: 2, microTo: 2 },
		{ id: 'im-w3', label: '3×2×5 сек', intensityPct: 95, microFrom: 3, microTo: 3 },
		{ id: 'im-w4', label: '3×2×5 сек', intensityPct: 95, microFrom: 4, microTo: 4 }
	]
};

export const ECCENTRIC_OVERLOAD_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'eccentric-overload',
	name: 'Эксцентрическая сверх-нагрузка',
	description:
		'Акцент на негативной фазе 5–6 сек: 90–120% 1ПМ, 2–9 повторений (10–25 для подтягиваний). Основные движения — раз в 2 недели или раз в мезоцикл.',
	phases: [
		{ id: 'eo-w1', label: '5×5 RIR-2', intensityPct: 90, microFrom: 1, microTo: 1 },
		{ id: 'eo-w2', label: '5×5, найти 5ПМ', intensityPct: 100, microFrom: 2, microTo: 2 },
		{ id: 'eo-w3', label: '5×5 110% 5ПМ', intensityPct: 110, microFrom: 3, microTo: 3 },
		{ id: 'eo-w4', label: '4×5 120% 5ПМ', intensityPct: 120, microFrom: 4, microTo: 4 }
	]
};

export const STRENGTH_PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
	MAX_EFFORT_PROTOCOL_TEMPLATE,
	REPEATED_EFFORT_PROTOCOL_TEMPLATE,
	SUBMAX_EFFORT_PROTOCOL_TEMPLATE,
	DYNAMIC_EFFORT_PROTOCOL_TEMPLATE,
	CLUSTER_PROTOCOL_TEMPLATE,
	ISOMETRIC_MAX_PROTOCOL_TEMPLATE,
	ECCENTRIC_OVERLOAD_PROTOCOL_TEMPLATE
];

export function bundledProtocolTemplates(): ProtocolTemplate[] {
	return STRENGTH_PROTOCOL_TEMPLATES.map((item) => structuredClone(item));
}

export function isBundledProtocolId(id: string): boolean {
	return STRENGTH_PROTOCOL_TEMPLATES.some((item) => item.id === id);
}

export function isCustomProtocolId(id: string): boolean {
	return id.startsWith('custom-');
}

export function bundledProtocolById(id: string): ProtocolTemplate | null {
	const found = STRENGTH_PROTOCOL_TEMPLATES.find((item) => item.id === id);
	return found ? structuredClone(found) : null;
}

export const DEFAULT_PROTOCOL_TEMPLATE: ProtocolTemplate = STRENGTH_PROTOCOL_TEMPLATES[0];

/** @deprecated оставлен для старых планов с линейной периодизацией */
export const LEGACY_LINEAR_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'linear-4',
	name: 'Линейный 4×микро',
	description: 'Классическая линейная периодизация по микроциклам.',
	phases: [
		{ id: 'p1', label: 'Втягивание', intensityPct: 75, microFrom: 1, microTo: 1 },
		{ id: 'p2', label: 'Накопление', intensityPct: 80, microFrom: 2, microTo: 2 },
		{ id: 'p3', label: 'Интенсификация', intensityPct: 85, microFrom: 3, microTo: 3 },
		{ id: 'p4', label: 'Разгрузка', intensityPct: 70, microFrom: 4, microTo: 4 }
	]
};

/** @deprecated оставлен для старых планов */
export const STABLE_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'stable-80',
	name: 'Стабильный ~80%',
	description: 'Одна рабочая интенсивность на весь мезоцикл.',
	phases: [{ id: 's1', label: 'Рабочий', intensityPct: 80, microFrom: 1, microTo: 12 }]
};

/** @deprecated используй LEGACY_LINEAR_PROTOCOL_TEMPLATE */
export const LINEAR_PROTOCOL_TEMPLATE = LEGACY_LINEAR_PROTOCOL_TEMPLATE;

export function phaseForMicro(template: ProtocolTemplate, microIndex: number): ProtocolPhase | null {
	return (
		template.phases.find(
			(phase) => microIndex >= phase.microFrom && microIndex <= phase.microTo
		) ?? null
	);
}

export function targetWeight(anchor1rm: number, intensityPct: number): number {
	return Math.round((anchor1rm * intensityPct) / 100 * 2) / 2;
}

export function intensityPctOf1rm(weight: number, anchor1rm: number): number | null {
	if (!anchor1rm) return null;
	return Math.round((weight / anchor1rm) * 1000) / 10;
}

/** @deprecated используй best1rmBeforeDate */
export function anchor1rmBeforeDate(
	entries: WorkoutEntry[],
	exercise: string,
	beforeDate: string
): number | null {
	return best1rmBeforeDate(entries, exercise, beforeDate)?.value ?? null;
}

export type SessionIntensity = {
	exercise: string;
	date: string;
	anchor1rm: number;
	targetPct: number;
	targetWeight: number;
	avgWeight: number;
	maxWeight: number;
	avgPct: number;
	maxPct: number;
	protocolLabel?: string;
	/** Нет записи в этом микро — показана только цель по протоколу. */
	plannedOnly?: boolean;
};

export function sessionIntensity(
	entry: WorkoutEntry,
	anchor1rm: number,
	targetPct: number
): SessionIntensity | null {
	if (!entry.sets.length || !anchor1rm) return null;
	const tonnage = entry.sets.reduce((sum, [w, r]) => sum + w * r, 0);
	const reps = entry.sets.reduce((sum, [, r]) => sum + r, 0);
	const avgWeight = reps ? tonnage / reps : 0;
	const maxWeight = Math.max(...entry.sets.map(([w]) => w));
	return {
		exercise: entry.exercise,
		date: entry.date,
		anchor1rm,
		targetPct,
		targetWeight: targetWeight(anchor1rm, targetPct),
		avgWeight: Math.round(avgWeight * 10) / 10,
		maxWeight,
		avgPct: intensityPctOf1rm(avgWeight, anchor1rm) ?? 0,
		maxPct: intensityPctOf1rm(maxWeight, anchor1rm) ?? 0
	};
}

const COMPOUND_RE =
	/присед|жим|тяга|румынск|лендмайн|сплит|станов|выпад|подтяг|отжим/i;
const CARDIO_RE = /бег|кардио|элипс/i;

export function isCardioExercise(name: string): boolean {
	return CARDIO_RE.test(name);
}

/** Все силовые упражнения мезо (без кардио), базовые — первыми. */
export function pickMesoExercises(exercises: string[]): string[] {
	return exercises
		.filter((name) => !isCardioExercise(name))
		.sort((a, b) => {
			const aCompound = COMPOUND_RE.test(a) ? 0 : 1;
			const bCompound = COMPOUND_RE.test(b) ? 0 : 1;
			if (aCompound !== bCompound) return aCompound - bCompound;
			return a.localeCompare(b, 'ru');
		});
}

/** @deprecated используй pickMesoExercises */
export function pickAnchorExercises(exercises: string[], limit?: number): string[] {
	const picked = pickMesoExercises(exercises);
	return limit ? picked.slice(0, limit) : picked;
}

export function shortExerciseName(name: string): string {
	if (name.includes('Приседания')) return 'присед';
	if (name.includes('Сплит')) return 'сплит';
	if (name.includes('лендмайн')) return 'лендмайн';
	if (name.includes('Жим гантелей лёжа')) return 'жим лёжа';
	if (name.includes('Румынская')) return 'RDL';
	if (name.includes('Горизонтальная тяга')) return 'тяга';
	if (name.includes('Вертикальная тяга')) return 'тяга V';
	if (name.includes('Вертикальный жим')) return 'жим V';
	if (name.includes('Скручивания')) return 'пресс';
	return name.split(' ').slice(0, 2).join(' ').toLowerCase();
}

export function newPhaseId(): string {
	return `phase-${crypto.randomUUID().slice(0, 8)}`;
}

export function newTemplateId(): string {
	return `tpl-${crypto.randomUUID().slice(0, 8)}`;
}

export function plannedSessionIntensity(
	exercise: string,
	anchor1rm: number,
	targetPct: number,
	protocolLabel?: string
): SessionIntensity {
	return {
		exercise,
		date: '',
		anchor1rm,
		targetPct,
		targetWeight: targetWeight(anchor1rm, targetPct),
		avgWeight: 0,
		maxWeight: 0,
		avgPct: 0,
		maxPct: 0,
		protocolLabel,
		plannedOnly: true
	};
}
