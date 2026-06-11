export type SchemaField = {
	name: string;
	type: string;
	optional?: boolean;
	description: string;
};

export type SchemaEntity = {
	id: string;
	title: string;
	group: 'workouts' | 'cycles' | 'derived' | 'protocol';
	stored: boolean;
	source?: string;
	description: string;
	fields: SchemaField[];
	example?: string;
	relations?: string[];
};

export const SCHEMA_GROUPS = [
	{ id: 'workouts', label: 'workouts.json', hint: 'каталог упражнений и факты' },
	{ id: 'cycles', label: 'cycle-plan.json', hint: 'план макро / мезо / микро' },
	{ id: 'protocol', label: 'Протоколы', hint: 'шаблоны фаз и интенсивности' },
	{ id: 'derived', label: 'Производные', hint: 'собираются в памяти для UI' }
] as const;

export const SCHEMA_ENTITIES: SchemaEntity[] = [
	{
		id: 'workout-database',
		title: 'WorkoutDatabase',
		group: 'workouts',
		stored: true,
		source: 'data/workouts.json',
		description: 'Корень файла тренировок. Версия 3 — единственный поддерживаемый формат на диске.',
		fields: [
			{ name: 'version', type: '3', description: 'Номер схемы' },
			{ name: 'updatedAt', type: 'string', description: 'ISO-время последней записи' },
			{ name: 'exercises', type: 'Exercise[]', description: 'Каталог упражнений' },
			{ name: 'logs', type: 'ExerciseLog[]', description: 'Факты выполнения по датам' }
		],
		example: `{
  "version": 3,
  "updatedAt": "2026-06-11T12:00:00.000Z",
  "exercises": [ … ],
  "logs": [ … ]
}`,
		relations: ['Exercise', 'ExerciseLog']
	},
	{
		id: 'exercise',
		title: 'Exercise',
		group: 'workouts',
		stored: true,
		source: 'workouts.json → exercises[]',
		description: 'Справочник упражнения. Id стабилен; имя может меняться.',
		fields: [
			{ name: 'id', type: 'string', description: 'Slug, напр. bench-press' },
			{ name: 'name', type: 'string', description: 'Отображаемое название' },
			{ name: 'kind', type: "'strength' | 'run' | 'jumps'", description: 'Тип нагрузки', optional: true },
			{
				name: 'movementBlocks',
				type: 'MovementBlockId[]',
				description: 'Блоки движения для карты тела',
				optional: true
			}
		],
		example: `// runtime
{ "id": "bench-press", "name": "Жим лёжа", "kind": "strength", "movementBlocks": ["chest"] }

// compact (на диске)
{ "id": "bench-press", "n": "Жим лёжа", "k": "strength", "b": ["chest"] }`,
		relations: ['ExerciseLog.exerciseId']
	},
	{
		id: 'exercise-log',
		title: 'ExerciseLog',
		group: 'workouts',
		stored: true,
		source: 'workouts.json → logs[]',
		description:
			'Одна запись по упражнению за дату. Раньше хранилась как WorkoutSession с именем вместо exerciseId.',
		fields: [
			{ name: 'id', type: 'string', description: 'UUID записи' },
			{ name: 'exerciseId', type: 'string', description: 'Ссылка на Exercise.id' },
			{ name: 'date', type: 'string', description: 'YYYY-MM-DD' },
			{ name: 'blocks', type: 'SetBlock[]', description: 'Блоки подходов (разминка / рабочие / др.)' },
			{
				name: 'microSessionId',
				type: 'string',
				description: 'Привязка к слоту микроцикла (MicroSessionPlan.id)',
				optional: true
			}
		],
		example: `// runtime
{
  "id": "log-abc",
  "exerciseId": "bench-press",
  "date": "2026-06-10",
  "blocks": [{ "sets": [[80, 5], [80, 5]], "comment": null }],
  "microSessionId": "ms-a1b2c3d4"
}

// compact
{
  "id": "log-abc",
  "e": "bench-press",
  "d": "2026-06-10",
  "ms": "ms-a1b2c3d4",
  "rows": [{ "s": [[80, 5], [80, 5]], "c": "лёгко" }]
}`,
		relations: ['Exercise', 'MicroSessionPlan', 'SetBlock']
	},
	{
		id: 'set-block',
		title: 'SetBlock',
		group: 'workouts',
		stored: true,
		source: 'logs[].blocks / rows[]',
		description: 'Группа подходов с общим комментарием.',
		fields: [
			{ name: 'sets', type: '[weight, reps][]', description: 'Пары вес (кг) × повторения' },
			{ name: 'comment', type: 'string | null', description: 'Заметка к блоку', optional: true }
		],
		example: `{ "sets": [[100, 3], [100, 3]], "comment": "RPE 8" }`
	},
	{
		id: 'cycle-plan',
		title: 'CyclePlan',
		group: 'cycles',
		stored: true,
		source: 'data/cycle-plan.json',
		description: 'План периодизации. Шаблоны протоколов — bundled + кастомные overrides.',
		fields: [
			{ name: 'version', type: '3', description: 'Номер схемы' },
			{ name: 'updatedAt', type: 'string', description: 'ISO-время' },
			{ name: 'templates', type: 'ProtocolTemplate[]', description: 'Только изменённые / кастомные шаблоны' },
			{ name: 'macrocycles', type: 'MacrocyclePlan[]', description: 'Макроциклы' },
			{ name: 'mesocycles', type: 'MesocyclePlan[]', description: 'Мезоциклы с микро и якорями' }
		],
		example: `{
  "version": 3,
  "updatedAt": "…",
  "templates": [],
  "macrocycles": [{ "id": "macro-1", "label": "Сила", "startDate": "…", "endDate": "…", "mesoIds": ["meso-1"] }],
  "mesocycles": [ … ]
}`,
		relations: ['MacrocyclePlan', 'MesocyclePlan', 'ProtocolTemplate']
	},
	{
		id: 'macrocycle-plan',
		title: 'MacrocyclePlan',
		group: 'cycles',
		stored: true,
		source: 'cycle-plan.json → macrocycles[]',
		description: 'Длинный блок (сезон / подготовка). Содержит упорядоченный список мезо.',
		fields: [
			{ name: 'id', type: 'string', description: 'Идентификатор' },
			{ name: 'label', type: 'string', description: 'Название' },
			{ name: 'startDate', type: 'string', description: 'YYYY-MM-DD' },
			{ name: 'endDate', type: 'string', description: 'YYYY-MM-DD' },
			{ name: 'mesoIds', type: 'string[]', description: 'Порядок MesocyclePlan.id' },
			{ name: 'note', type: 'string', description: 'Заметка', optional: true }
		],
		relations: ['MesocyclePlan']
	},
	{
		id: 'mesocycle-plan',
		title: 'MesocyclePlan',
		group: 'cycles',
		stored: true,
		source: 'cycle-plan.json → mesocycles[]',
		description: 'Блок ~4 микроцикла. Якоря 1ПМ и протоколы задаются по имени упражнения.',
		fields: [
			{ name: 'id', type: 'string', description: 'Идентификатор' },
			{ name: 'label', type: 'string', description: 'Название мезо' },
			{ name: 'startDate', type: 'string', description: 'YYYY-MM-DD' },
			{ name: 'endDate', type: 'string', description: 'YYYY-MM-DD' },
			{ name: 'microcycles', type: 'MicrocyclePlan[]', description: '2 сессии A/B на каждый μ' },
			{ name: 'macroId', type: 'string', description: 'Родительский макро', optional: true },
			{ name: 'templateId', type: 'string', description: 'Протокол по умолчанию для мезо' },
			{ name: 'anchor1rm', type: 'Record<exerciseId, kg>', description: 'Якорные 1ПМ на старт мезо' },
			{
				name: 'anchor1rmManual',
				type: 'Record<exerciseId, boolean>',
				description: 'Ручной якорь — не пересчитывать',
				optional: true
			},
			{
				name: 'exerciseProtocols',
				type: 'Record<exerciseId, templateId>',
				description: 'Свой протокол на упражнение',
				optional: true
			}
		],
		relations: ['MicrocyclePlan', 'ProtocolTemplate']
	},
	{
		id: 'microcycle-plan',
		title: 'MicrocyclePlan',
		group: 'cycles',
		stored: true,
		source: 'cycle-plan.json → mesocycles[].microcycles[]',
		description: 'Микроцикл = две микросессии (слоты 0 и 1). Даты опциональны — план vs факт.',
		fields: [
			{ name: 'id', type: 'string', description: 'Идентификатор μ' },
			{ name: 'indexInMeso', type: 'number', description: 'Порядковый номер в мезо (0-based)' },
			{ name: 'sessions', type: 'MicroSessionPlan[]', description: 'Ровно 2 элемента: A (0) и B (1)' },
			{ name: 'label', type: 'string', description: 'Подпись недели', optional: true },
			{ name: 'intensityPct', type: 'number', description: 'Override интенсивности %', optional: true }
		],
		example: `{
  "id": "micro-3",
  "indexInMeso": 2,
  "sessions": [
    { "id": "ms-aaa", "indexInMicro": 0, "date": "2026-06-03" },
    { "id": "ms-bbb", "indexInMicro": 1, "date": "2026-06-06" }
  ]
}

// compact session: { "id", "i", "d?" }`,
		relations: ['MicroSessionPlan']
	},
	{
		id: 'micro-session-plan',
		title: 'MicroSessionPlan',
		group: 'cycles',
		stored: true,
		source: 'microcycles[].sessions[]',
		description:
			'Элемент микроцикла — один визит в зал. indexInMicro 0 = «A», 1 = «B» (только UI, не в логах).',
		fields: [
			{ name: 'id', type: 'string', description: 'ms-xxxxxxxx, ссылка из ExerciseLog.microSessionId' },
			{ name: 'indexInMicro', type: '0 | 1', description: 'Слот A/B' },
			{ name: 'date', type: 'string', description: 'Назначенная дата YYYY-MM-DD', optional: true }
		],
		relations: ['ExerciseLog.microSessionId']
	},
	{
		id: 'protocol-template',
		title: 'ProtocolTemplate',
		group: 'protocol',
		stored: true,
		source: 'bundled в коде + cycle-plan.json → templates[]',
		description: 'Метод тренировки: фазы с целевой интенсивностью по номерам микроциклов.',
		fields: [
			{ name: 'id', type: 'string', description: 'max-effort, repeated-effort, …' },
			{ name: 'name', type: 'string', description: 'Человекочитаемое название' },
			{ name: 'description', type: 'string', description: 'Краткое описание', optional: true },
			{ name: 'phases', type: 'ProtocolPhase[]', description: 'Фазы периодизации' }
		],
		relations: ['ProtocolPhase', 'MesocyclePlan.templateId']
	},
	{
		id: 'protocol-phase',
		title: 'ProtocolPhase',
		group: 'protocol',
		stored: true,
		source: 'ProtocolTemplate.phases[]',
		description: 'Диапазон микроциклов с одной целевой интенсивностью.',
		fields: [
			{ name: 'id', type: 'string', description: 'Идентификатор фазы' },
			{ name: 'label', type: 'string', description: 'Подпись в UI' },
			{ name: 'intensityPct', type: 'number', description: '% от 1ПМ (80 = 80%)' },
			{ name: 'microFrom', type: 'number', description: 'Первый μ фазы (1-based)' },
			{ name: 'microTo', type: 'number', description: 'Последний μ фазы (1-based)' }
		]
	},
	{
		id: 'workout-session',
		title: 'WorkoutSession',
		group: 'derived',
		stored: false,
		source: 'logsToSessions()',
		description: 'Развёрнутый лог с именем упражнения — для истории, статистики и графиков.',
		fields: [
			{ name: 'id', type: 'string', description: 'Из ExerciseLog.id' },
			{ name: 'exerciseId', type: 'string', description: 'Из каталога' },
			{ name: 'exercise', type: 'string', description: 'Exercise.name' },
			{ name: 'date', type: 'string', description: 'YYYY-MM-DD' },
			{ name: 'rows', type: 'SessionRow[]', description: 'blocks → rows' },
			{ name: 'microSessionId', type: 'string', optional: true, description: 'Как в логе' }
		],
		relations: ['ExerciseLog', 'Exercise']
	},
	{
		id: 'training-day',
		title: 'TrainingDay',
		group: 'derived',
		stored: false,
		source: 'buildMicrocycleOverview()',
		description: 'Кластер фактических тренировок за дату + слот. Не пишется в JSON.',
		fields: [
			{ name: 'date', type: 'string', description: 'YYYY-MM-DD' },
			{ name: 'exercises', type: 'string[]', description: 'Имена упражнений за день' },
			{ name: 'indexInMicro', type: 'number', description: '0 = A, 1 = B' },
			{ name: 'confidence', type: 'number', description: 'Уверенность авто-классификации слота' }
		],
		relations: ['Microcycle.sessions']
	},
	{
		id: 'microcycle-overview',
		title: 'MicrocycleOverview',
		group: 'derived',
		stored: false,
		source: 'buildMicrocycleOverview()',
		description: 'Полная картина μ / мезо из логов + плана. Питает страницы «Сегодня» и «Циклы».',
		fields: [
			{ name: 'templates', type: 'WorkoutTemplate[]', description: 'Типовые A/B по упражнениям' },
			{ name: 'days', type: 'TrainingDay[]', description: 'Все дни с фактами' },
			{ name: 'cycles', type: 'Microcycle[]', description: 'Сгруппированные μ' },
			{ name: 'mesocycles', type: 'Mesocycle[]', description: 'Сгруппированные мезо' },
			{ name: 'byDate', type: 'Map<date, TrainingDay>', description: 'Быстрый lookup' }
		]
	}
];

export const SCHEMA_DIAGRAM = `Exercise (catalog)
    │
    └──< ExerciseLog (fact, by date)
              │
              ├── blocks[] → SetBlock → sets [w,r][]
              │
              └── microSessionId? ──> MicroSessionPlan (plan slot A/B)
                                              │
MicrocyclePlan ── sessions[2] ────────────────┘
       │
MesocyclePlan ── microcycles[], anchor1rm, templateId
       │
MacrocyclePlan ── mesoIds[]
       │
CyclePlan (cycle-plan.json)

WorkoutSession = expand(ExerciseLog + Exercise.name)`;
