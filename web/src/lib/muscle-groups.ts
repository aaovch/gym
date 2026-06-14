import type { StrengthSummary, TrendPoint } from './types';

export type MovementBlockId =
	| 'knee_dominant'
	| 'hip_dominant'
	| 'horizontal_push'
	| 'vertical_push'
	| 'horizontal_pull'
	| 'vertical_pull'
	| 'core'
	| 'arms'
	| 'conditioning';

export type MovementBlock = {
	id: MovementBlockId;
	label: string;
	shortLabel: string;
	description: string;
	color: string;
};

export const MOVEMENT_BLOCKS: MovementBlock[] = [
	{
		id: 'knee_dominant',
		label: 'Коленодоминантные',
		shortLabel: 'Колено',
		description: 'Приседы, сплиты, прыжковая работа — основная нагрузка через колено.',
		color: '#6ee7a8'
	},
	{
		id: 'hip_dominant',
		label: 'Тазодоминантные',
		shortLabel: 'Таз',
		description: 'Тяги с акцентом на таз, бёдра и заднюю поверхность.',
		color: '#a78bfa'
	},
	{
		id: 'horizontal_push',
		label: 'Горизонтальный жим',
		shortLabel: 'Жим г',
		description: 'Жимовые движения в горизонтальной плоскости — грудь и трицепс.',
		color: '#5b9dff'
	},
	{
		id: 'vertical_push',
		label: 'Вертикальный жим',
		shortLabel: 'Жим в',
		description: 'Жим над головой и подъёмы на плечи.',
		color: '#fbbf24'
	},
	{
		id: 'horizontal_pull',
		label: 'Горизонтальная тяга',
		shortLabel: 'Тяга г',
		description: 'Тяга к корпусу — спина, задние дельты, бицепс.',
		color: '#f472b6'
	},
	{
		id: 'vertical_pull',
		label: 'Вертикальная тяга',
		shortLabel: 'Тяга в',
		description: 'Тяга сверху — широчайшие и верх спины.',
		color: '#2dd4bf'
	},
	{
		id: 'core',
		label: 'Кор / пресс',
		shortLabel: 'Кор',
		description: 'Скручивания и стабилизация корпуса.',
		color: '#fb923c'
	},
	{
		id: 'arms',
		label: 'Руки и предплечья',
		shortLabel: 'Руки',
		description: 'Изоляция бицепса, трицепса и предплечий.',
		color: '#94a3b8'
	},
	{
		id: 'conditioning',
		label: 'Кардио и взрывная',
		shortLabel: 'Кардио',
		description: 'Бег и аэробная нагрузка.',
		color: '#38bdf8'
	}
];

const EXERCISE_BLOCK_MAP: Record<string, MovementBlockId> = {
	'Приседания со штангой на спине': 'knee_dominant',
	'Сплит-присед': 'knee_dominant',
	'Скоростные прыжки на тумбу (Напрыжка)': 'knee_dominant',
	'Румынская тяга с плинтов': 'hip_dominant',
	'Жим лендмайн': 'horizontal_push',
	'Жим гантелей лёжа': 'horizontal_push',
	'Вертикальный жим гантелей сидя': 'vertical_push',
	'Фронтальный подъём гантелей': 'vertical_push',
	'Горизонтальная тяга': 'horizontal_pull',
	'Вертикальная тяга на блоке': 'vertical_pull',
	'Вертикальная тяга одной рукой на блочном тренажёре сидя': 'vertical_pull',
	'Скручивания на пресс с весом лёжа': 'core',
	'Сгибание рук со штангой': 'arms',
	'Сгибание запястий со штангой': 'arms',
	'Разгибание предплечья на блочном тренажёре': 'arms',
	Подтягивания: 'vertical_pull',
	'Ротация корпуса': 'core',
	Бег: 'conditioning'
};

export function getMovementBlock(exercise: string): MovementBlockId | null {
	if (EXERCISE_BLOCK_MAP[exercise]) return EXERCISE_BLOCK_MAP[exercise];

	const lower = exercise.toLowerCase();

	if (lower.includes('бег') || lower.includes('кардио') || lower.includes('элипс')) {
		return 'conditioning';
	}
	if (lower.includes('прыж') || lower.includes('присед') || lower.includes('сплит') || lower.includes('выпад')) {
		return 'knee_dominant';
	}
	if (lower.includes('румын') || lower.includes('станов') || lower.includes('мертв')) {
		return 'hip_dominant';
	}
	if (lower.includes('пресс') || lower.includes('скруч') || lower.includes('планк') || lower.includes('ротац')) {
		return 'core';
	}
	if (lower.includes('подтяг')) {
		return 'vertical_pull';
	}
	if (
		lower.includes('бицеп') ||
		lower.includes('трицеп') ||
		lower.includes('сгибан') ||
		lower.includes('разгибан') ||
		lower.includes('предплеч') ||
		lower.includes('запяст')
	) {
		return 'arms';
	}
	if (lower.includes('тяга')) {
		if (lower.includes('горизонт') || lower.includes('к поясу') || lower.includes('в наклон')) {
			return 'horizontal_pull';
		}
		return 'vertical_pull';
	}
	if (lower.includes('жим') || lower.includes('отжим')) {
		if (lower.includes('лендмайн') || lower.includes('лёжа') || lower.includes('лежа')) {
			return 'horizontal_push';
		}
		if (lower.includes('сидя') || lower.includes('стоя') || lower.includes('армейск')) {
			return 'vertical_push';
		}
		if (lower.includes('подъём') || lower.includes('подъем')) {
			return 'vertical_push';
		}
		return 'horizontal_push';
	}

	return null;
}

export function getMovementBlockMeta(id: MovementBlockId): MovementBlock {
	return MOVEMENT_BLOCKS.find((block) => block.id === id)!;
}

export type BlockExerciseView = {
	exercise: string;
	summary: StrengthSummary | null;
	trend: TrendPoint[];
	sessions: number;
};

export type BlockOverview = {
	block: MovementBlock;
	exercises: BlockExerciseView[];
};

export function buildBlockOverview(
	exercises: string[],
	summary: StrengthSummary[],
	trend: Record<string, TrendPoint[]>,
	sessionCounts: Map<string, number>
): BlockOverview[] {
	const byBlock = new Map<MovementBlockId, BlockExerciseView[]>();

	for (const exercise of exercises) {
		const blockId = getMovementBlock(exercise);
		if (!blockId) continue;

		const item: BlockExerciseView = {
			exercise,
			summary: summary.find((row) => row.exercise === exercise) ?? null,
			trend: trend[exercise] ?? [],
			sessions: sessionCounts.get(exercise) ?? 0
		};

		if (!byBlock.has(blockId)) byBlock.set(blockId, []);
		byBlock.get(blockId)!.push(item);
	}

	return MOVEMENT_BLOCKS.filter((block) => byBlock.has(block.id))
		.map((block) => ({
			block,
			exercises: byBlock
				.get(block.id)!
				.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
		}));
}

export function blocksWithData(overview: BlockOverview[]): MovementBlockId[] {
	return overview.map((item) => item.block.id);
}
