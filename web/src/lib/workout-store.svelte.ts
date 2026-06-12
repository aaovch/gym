import { getGitHubToken } from './auth';
import {
	assignSessionToMicro,
	autoMesocyclesAsView,
	buildCyclePlanView,
	bundledProtocolTemplates,
	normalizeCyclePlan,
	importPlanFromAuto,
	purgeExerciseFromPlan,
	refreshAllMesoAnchors,
	repairMicroDatesFromAuto,
	suggestSessionIndex,
	type CyclePlan
} from './cycle-plan';
import { repairWorkoutLinks, summarizeLogMicroLinks } from './data-repair';
import { removeExerciseFromCatalog, upsertExercise } from './exercises';
import { buildWorkoutKeyMaps } from './exercise-keys';
import { sessionsToEntries } from './database';
import { fetchCyclePlan, fetchWorkoutDatabase, saveCyclePlanRemote, saveWorkoutDatabase, verifyGitHubToken } from './github';
import { logsToSessions as expandLogs } from './json-store';
import {
	clearCyclePlan,
	clearLocalDatabase,
	loadCyclePlan,
	loadLocalDatabase,
	pickNewerCyclePlan,
	pickNewerDatabase,
	saveCyclePlan,
	saveLocalDatabase
} from './storage';
import { buildWorkoutData } from './stats';
import { buildMicrocycleOverview } from './microcycle';
import type { Exercise, ExerciseLog, WorkoutDatabase, WorkoutEntry, WorkoutSession } from './types';

type SyncState = {
	workoutsSha: string | null;
	cyclePlanSha: string | null;
	githubLogin: string | null;
	syncing: boolean;
	error: string;
	message: string;
	source: 'bundled' | 'local' | 'github';
};

function emptyDatabase(): WorkoutDatabase {
	return { version: 4, revision: 0, updatedAt: '', exercises: [], logs: [] };
}

function normalizeLoadedCyclePlan(
	plan: CyclePlan | null,
	byDate?: Map<string, import('./microcycle').TrainingDay>
): CyclePlan | null {
	if (!plan) return null;
	const merged = normalizeCyclePlan(plan, byDate);
	const changed = JSON.stringify(merged) !== JSON.stringify(plan);
	if (changed) saveCyclePlan(merged);
	return merged;
}

function buildView(database: WorkoutDatabase, cyclePlan: CyclePlan | null) {
	const sessions = expandLogs(database);
	const entries = sessionsToEntries(sessions);
	const keyMaps = buildWorkoutKeyMaps(database.exercises, entries);
	const computed = buildWorkoutData(entries);
	const microcycles = buildMicrocycleOverview(sessions);
	const allDates = [...new Set(entries.map((entry) => entry.date))].sort();
	const cyclePlanView = buildCyclePlanView(cyclePlan, microcycles, entries, allDates, database.exercises);
	const mesocycles =
		cyclePlanView.usingManualPlan && cyclePlanView.mesocycles.length > 0
			? cyclePlanView.mesocycles
			: autoMesocyclesAsView(microcycles, entries);
	const cyclePlanForCalc: CyclePlan = cyclePlan
			? normalizeCyclePlan(cyclePlan, microcycles.byDate)
			: {
				version: 4,
				revision: 0,
				updatedAt: '',
				templates: bundledProtocolTemplates(),
				macrocycles: [],
				mesocycles: []
			};

	return {
		entries,
		summary: computed.summary,
		trend: computed.trend,
		sessions,
		logs: database.logs,
		exercises: database.exercises,
		updatedAt: database.updatedAt,
		microcycles,
		cyclePlan,
		cyclePlanForCalc,
		cyclePlanView: { ...cyclePlanView, mesocycles },
		allDates,
		keyMaps,
		templates: cyclePlanForCalc.templates,
		protocolTemplates: cyclePlanForCalc.templates,
		workoutTemplates: microcycles.templates
	};
}

class WorkoutStore {
	database = $state.raw<WorkoutDatabase>(emptyDatabase());
	cyclePlan = $state.raw<CyclePlan | null>(normalizeLoadedCyclePlan(loadCyclePlan()));
	sync = $state<SyncState>({
		workoutsSha: null,
		cyclePlanSha: null,
		githubLogin: null,
		syncing: false,
		error: '',
		message: '',
		source: 'bundled'
	});

	view = $derived.by(() => buildView(this.database, this.cyclePlan));

	private githubInitStarted = false;

	patchSync(patch: Partial<SyncState>) {
		this.sync = { ...this.sync, ...patch };
	}

	bootstrap(bundled: WorkoutDatabase, bundledCyclePlan: CyclePlan | null = null) {
		const local = loadLocalDatabase();
		const initial = pickNewerDatabase(bundled, local);
		const source =
			local && Date.parse(local.updatedAt) > Date.parse(bundled.updatedAt || '0') ? 'local' : 'bundled';
		this.applyDatabase(initial, source);

		const localPlan = loadCyclePlan();
		const planCandidates = [localPlan, bundledCyclePlan].filter(
			(item): item is CyclePlan => item != null
		);
		if (planCandidates.length > 0) {
			const bestPlan = planCandidates.reduce((winner, item) => pickNewerCyclePlan(winner, item));
			this.cyclePlan = normalizeLoadedCyclePlan(bestPlan, this.view.microcycles.byDate);
		}
	}

	connectIfTokenSaved() {
		if (this.githubInitStarted) return;
		this.githubInitStarted = true;
		const token = getGitHubToken();
		if (token) {
			void this.connectGitHub(token).catch(() => {
				// keep bundled snapshot
			});
		}
	}

	applyDatabase(db: WorkoutDatabase, source: SyncState['source']) {
		this.database = structuredClone(db);
		this.patchSync({ source });
	}

	private persistLocally(db: WorkoutDatabase) {
		const next = {
			...db,
			revision: db.revision + 1,
			updatedAt: new Date().toISOString()
		};
		this.database = next;
		saveLocalDatabase(next);
		this.patchSync({ source: 'local' });
		return next;
	}

	private persistCyclePlan(plan: CyclePlan) {
		const next = normalizeCyclePlan(
			{ ...plan, updatedAt: new Date().toISOString() },
			this.view.microcycles.byDate
		);
		this.cyclePlan = next;
		saveCyclePlan(next);
		this.patchSync({ source: 'local' });
	}

	private async persistCyclePlanToGitHub(token: string, plan: CyclePlan) {
		const { sha } = await fetchCyclePlan(token);
		const nextSha = await saveCyclePlanRemote(token, plan, sha, 'Sync cycle plan from app');
		this.patchSync({ cyclePlanSha: nextSha });
	}

	private async persistToGitHub(token: string, db: WorkoutDatabase, message: string) {
		const { sha } = await fetchWorkoutDatabase(token);
		const nextSha = await saveWorkoutDatabase(token, db, sha, message);
		this.patchSync({ workoutsSha: nextSha });
	}

	private persistDatabase() {
		this.persistLocally(this.database);
		this.patchSync({
			error: '',
			message: getGitHubToken()
				? 'Сохранено локально. Нажмите «Отправить в GitHub», когда закончите правки.'
				: 'Сохранено локально в браузере.'
		});
	}

	async saveLog(
		log: ExerciseLog,
		context?: { mesoId: string; microId: string; indexInMicro?: number }
	) {
		const db = this.database;
		const index = db.logs.findIndex((item) => item.id === log.id);
		const logs =
			index === -1 ? [...db.logs, log] : db.logs.map((item) => (item.id === log.id ? log : item));

		this.database = { ...db, logs };
		this.persistDatabase();

		if (!context?.mesoId || !context?.microId) return;

		const plan = this.cyclePlan;
		if (!plan) return;

		const microView = this.view.cyclePlanView.mesocycles
			.find((m) => m.plan.id === context.mesoId)
			?.microcycles.find((m) => m.plan.id === context.microId);
		const indexInMicro =
			context.indexInMicro ??
			(microView
				? suggestSessionIndex(microView, log.date, this.view.entries, this.view.workoutTemplates)
				: 0);

		const next = assignSessionToMicro(
			plan,
			context.mesoId,
			context.microId,
			log.date,
			indexInMicro
		);
		if (next !== plan) this.persistCyclePlan(next);
	}

	async saveSession(
		session: WorkoutSession,
		context?: { mesoId: string; microId: string; indexInMicro?: number }
	) {
		const log: ExerciseLog = {
			id: session.id,
			exerciseId: session.exerciseId,
			date: session.date,
			blocks: session.rows,
			microSessionId: session.microSessionId
		};
		await this.saveLog(log, context);
	}

	async deleteLog(logId: string) {
		const db = this.database;
		this.database = { ...db, logs: db.logs.filter((item) => item.id !== logId) };
		this.persistDatabase();
	}

	async deleteSession(sessionId: string) {
		await this.deleteLog(sessionId);
	}

	saveExercise(exercise: Exercise) {
		const db = this.database;
		this.database = {
			...db,
			exercises: upsertExercise(db.exercises, exercise)
		};
		this.persistDatabase();
	}

	deleteExercise(exerciseId: string) {
		const db = this.database;
		const logCount = db.logs.filter((log) => log.exerciseId === exerciseId).length;
		if (logCount > 0) {
			throw new Error(
				`Нельзя удалить: в журнале ${logCount} ${logCount === 1 ? 'запись' : logCount < 5 ? 'записи' : 'записей'}`
			);
		}

		this.database = {
			...db,
			exercises: removeExerciseFromCatalog(db.exercises, exerciseId)
		};
		this.persistDatabase();

		const plan = this.cyclePlan;
		if (plan) {
			this.persistCyclePlan(purgeExerciseFromPlan(plan, exerciseId));
		}
	}

	resetToBundled(bundled: WorkoutDatabase) {
		clearLocalDatabase();
		clearCyclePlan();
		this.cyclePlan = null;
		this.applyDatabase(bundled, 'bundled');
		this.patchSync({
			message: 'Локальные данные сброшены. Загружена версия с сайта.',
			error: ''
		});
	}

	importCyclePlanFromAuto() {
		const plan = importPlanFromAuto(
			this.view.microcycles,
			this.view.entries,
			this.cyclePlan
		);
		this.persistCyclePlan(plan);
		this.patchSync({
			message: 'План циклов импортирован из автоопределения. Можно редактировать.',
			error: ''
		});
	}

	saveCyclePlanState(plan: CyclePlan) {
		this.persistCyclePlan(plan);
	}

	refreshMesoAnchorsFromData(keepManual = true) {
		const plan = this.cyclePlan;
		if (!plan) return;
		this.persistCyclePlan(
			refreshAllMesoAnchors(plan, this.view.entries, keepManual, this.view.keyMaps)
		);
		this.patchSync({
			message: keepManual
				? '1ПМ пересчитаны из данных (ручные значения сохранены).'
				: '1ПМ пересчитаны из данных (включая ручные).',
			error: ''
		});
	}

	repairMicroDatesFromAuto() {
		const plan = this.cyclePlan;
		if (!plan) return;
		const next = repairMicroDatesFromAuto(plan, this.view.microcycles);
		this.persistCyclePlan(next);
		this.patchSync({
			message: 'Дни по μ восстановлены из автоопределения по истории тренировок.',
			error: ''
		});
	}

	async repairWorkoutLinks() {
		const result = repairWorkoutLinks(this.database, this.cyclePlan, this.view.entries, {
			importPlanIfEmpty: true,
			repairPlanDates: true
		});

		this.database = result.database;
		saveLocalDatabase(result.database);

		if (result.plan) {
			this.persistCyclePlan(result.plan);
		}

		const linkSummary = summarizeLogMicroLinks(result.database.logs);
		const parts = [
			result.logsLinked > 0 ? `привязано логов: ${result.logsLinked}` : '',
			result.planImported ? 'план импортирован' : '',
			result.planDatesRepaired ? 'даты μ восстановлены' : '',
			result.anchorsRefreshed ? 'якоря пересчитаны' : ''
		].filter(Boolean);

		this.patchSync({
			source: 'local',
			message:
				parts.length > 0
					? `Данные восстановлены (${parts.join(', ')}). Логов с microSessionId: ${linkSummary.linked}/${linkSummary.total}.`
					: `Связи в порядке. Логов с microSessionId: ${linkSummary.linked}/${linkSummary.total}.`,
			error: ''
		});
	}

	clearCyclePlanState() {
		clearCyclePlan();
		this.cyclePlan = null;
		this.patchSync({
			message: 'Ручной план сброшен. Снова используется автоопределение.',
			error: ''
		});
	}

	async connectGitHub(token: string) {
		this.patchSync({ syncing: true, error: '', message: '' });
		try {
			const login = await verifyGitHubToken(token);
			const [{ db: remote, sha: workoutsSha }, { plan: remotePlan, sha: cyclePlanSha }] =
				await Promise.all([fetchWorkoutDatabase(token), fetchCyclePlan(token)]);
			const local = loadLocalDatabase();
			const localPlan = loadCyclePlan();
			const current = this.database;
			const best = [current, local, remote]
				.filter((item): item is WorkoutDatabase => item !== null)
				.reduce((winner, item) => pickNewerDatabase(winner, item));

			this.applyDatabase(best, best === remote ? 'github' : this.sync.source);
			saveLocalDatabase(best);

			const planCandidates = [this.cyclePlan, localPlan, remotePlan].filter(
				(item): item is CyclePlan => item != null
			);
			if (planCandidates.length > 0) {
				const bestPlan = planCandidates.reduce((winner, item) => pickNewerCyclePlan(winner, item));
				this.cyclePlan = normalizeLoadedCyclePlan(bestPlan, this.view.microcycles.byDate);
				if (bestPlan === remotePlan && remotePlan) saveCyclePlan(remotePlan);
			}

			this.sync = {
				workoutsSha,
				cyclePlanSha,
				githubLogin: login,
				syncing: false,
				error: '',
				message:
					best === remote
						? 'Подключено к GitHub. Загружены данные из репозитория.'
						: 'Подключено к GitHub. Локальные данные новее — отправьте их кнопкой «Отправить в GitHub».',
				source: best === remote ? 'github' : 'local'
			};
		} catch (error) {
			this.patchSync({
				syncing: false,
				error: error instanceof Error ? error.message : 'Ошибка подключения к GitHub'
			});
			throw error;
		}
	}

	async pushToGitHub(token: string) {
		if (this.sync.syncing) return;

		this.patchSync({ syncing: true, error: '', message: 'Отправка журнала тренировок…' });
		try {
			await this.persistToGitHub(token, this.database, 'Sync workouts from app');
			if (this.cyclePlan) {
				this.patchSync({ message: 'Отправка плана циклов…' });
				await this.persistCyclePlanToGitHub(token, this.cyclePlan);
			}
			this.patchSync({
				syncing: false,
				error: '',
				message: 'Отправлено в GitHub. Сайт обновится через 1–2 минуты.',
				source: 'github'
			});
		} catch (error) {
			this.patchSync({
				syncing: false,
				error: error instanceof Error ? error.message : 'Ошибка отправки в GitHub',
				message: ''
			});
			throw error;
		}
	}
}

export const workoutStore = new WorkoutStore();

export async function connectGitHub(token: string) {
	await workoutStore.connectGitHub(token);
}

export function bootstrapWorkoutStore(bundled: WorkoutDatabase, bundledCyclePlan: CyclePlan | null = null) {
	workoutStore.bootstrap(bundled, bundledCyclePlan);
}

export async function refreshFromGitHub(token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token');
	await connectGitHub(token);
}

export async function pushToGitHub(token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token');
	await workoutStore.pushToGitHub(token);
}

export async function saveLog(
	log: ExerciseLog,
	context?: { mesoId: string; microId: string; indexInMicro?: number }
) {
	await workoutStore.saveLog(log, context);
}

export async function saveSession(
	session: WorkoutSession,
	context?: { mesoId: string; microId: string; indexInMicro?: number }
) {
	await workoutStore.saveSession(session, context);
}

export async function deleteSession(sessionId: string) {
	await workoutStore.deleteSession(sessionId);
}

export function saveExercise(exercise: Exercise) {
	workoutStore.saveExercise(exercise);
}

export function deleteExercise(exerciseId: string) {
	workoutStore.deleteExercise(exerciseId);
}

export function resetToBundled(bundled: WorkoutDatabase) {
	workoutStore.resetToBundled(bundled);
}

export function importCyclePlanFromAuto() {
	workoutStore.importCyclePlanFromAuto();
}

export function saveCyclePlanState(plan: CyclePlan) {
	workoutStore.saveCyclePlanState(plan);
}

export function refreshMesoAnchorsFromData(keepManual = true) {
	workoutStore.refreshMesoAnchorsFromData(keepManual);
}

export function repairPlanMicroDatesFromAuto() {
	workoutStore.repairMicroDatesFromAuto();
}

export async function repairWorkoutLinksFromData() {
	await workoutStore.repairWorkoutLinks();
}

export function clearCyclePlanState() {
	workoutStore.clearCyclePlanState();
}
