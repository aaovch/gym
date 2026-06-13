import type { TrainingDay } from './microcycle';

export type MicroSessionPlan = {
	id: string;
	indexInMicro: 0 | 1;
	date?: string;
	/** Тренировка осознанно пропущена: не считается незаполненной и не выбирается автоматически. */
	skipped?: boolean;
};

export type MicrocyclePlan = {
	id: string;
	indexInMeso: number;
	sessions: [MicroSessionPlan, MicroSessionPlan];
	label?: string;
	intensityPct?: number;
};

function newSessionId(): string {
	return `ms-${crypto.randomUUID().slice(0, 8)}`;
}

export function defaultMicroSessions(): [MicroSessionPlan, MicroSessionPlan] {
	return [
		{ id: newSessionId(), indexInMicro: 0 },
		{ id: newSessionId(), indexInMicro: 1 }
	];
}

export function microDates(micro: Pick<MicrocyclePlan, 'sessions'>): string[] {
	return micro.sessions
		.map((session) => session.date)
		.filter((date): date is string => Boolean(date))
		.sort();
}

export function microHasDate(micro: Pick<MicrocyclePlan, 'sessions'>, date: string): boolean {
	return micro.sessions.some((session) => session.date === date);
}

export function sessionPlanByIndex(
	micro: Pick<MicrocyclePlan, 'sessions'>,
	indexInMicro: number
): MicroSessionPlan | undefined {
	return micro.sessions.find((session) => session.indexInMicro === indexInMicro);
}

export function normalizeMicrocyclePlan(micro: MicrocyclePlan): MicrocyclePlan {
	const byIndex = new Map(micro.sessions?.map((session) => [session.indexInMicro, session]));
	const defaults = defaultMicroSessions();
	return {
		id: micro.id,
		indexInMeso: micro.indexInMeso,
		label: micro.label,
		intensityPct: micro.intensityPct,
		sessions: [
			{ ...(byIndex.get(0) ?? defaults[0]), indexInMicro: 0 },
			{ ...(byIndex.get(1) ?? defaults[1]), indexInMicro: 1 }
		]
	};
}

export function normalizeMicrocycles(microcycles: MicrocyclePlan[]): MicrocyclePlan[] {
	return microcycles.map(normalizeMicrocyclePlan);
}

export function microFromOverviewDays(
	microId: string,
	indexInMeso: number,
	days: TrainingDay[]
): MicrocyclePlan {
	const sessions = defaultMicroSessions();
	for (const day of days) {
		const idx =
			day.indexInMicro >= 0 && day.indexInMicro <= 1
				? day.indexInMicro
				: sessions.findIndex((s) => !s.date);
		if (idx === 0 || idx === 1) sessions[idx] = { ...sessions[idx], date: day.date };
	}
	return normalizeMicrocyclePlan({ id: microId, indexInMeso, sessions });
}
