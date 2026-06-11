import { getGitHubToken } from './auth';
	import {
	assignSessionToMicro,
	autoMesocyclesAsView,
	buildCyclePlanView,
	bundledProtocolTemplates,
	normalizeCyclePlan,
	importPlanFromAuto,
	refreshAllMesoAnchors,
	repairMicroDatesFromAuto,
	type CyclePlan
} from './cycle-plan';
import { sessionsToEntries } from './database';
import { fetchWorkoutDatabase, saveWorkoutDatabase, verifyGitHubToken } from './github';
import {
	clearCyclePlan,
	clearLocalDatabase,
	loadCyclePlan,
	loadLocalDatabase,
	pickNewerDatabase,
	saveCyclePlan,
	saveLocalDatabase
} from './storage';
import { buildWorkoutData } from './stats';
import { buildMicrocycleOverview } from './microcycle';
import type { WorkoutDatabase, WorkoutSession } from './types';

type SyncState = {
	sha: string | null;
	githubLogin: string | null;
	syncing: boolean;
	error: string;
	message: string;
	source: 'bundled' | 'local' | 'github';
};

function emptyDatabase(): WorkoutDatabase {
	return { version: 1, updatedAt: '', sessions: [] };
}

function normalizeLoadedCyclePlan(plan: CyclePlan | null): CyclePlan | null {
	if (!plan) return null;
	const merged = normalizeCyclePlan(plan);
	const changed = JSON.stringify(merged) !== JSON.stringify(plan);
	if (changed) saveCyclePlan(merged);
	return merged;
}

function buildView(database: WorkoutDatabase, cyclePlan: CyclePlan | null) {
	const entries = sessionsToEntries(database.sessions);
	const computed = buildWorkoutData(entries);
	const microcycles = buildMicrocycleOverview(database.sessions);
	const allDates = [...new Set(entries.map((entry) => entry.date))].sort();
	const cyclePlanView = buildCyclePlanView(cyclePlan, microcycles, entries, allDates);
	const mesocycles =
		cyclePlanView.usingManualPlan && cyclePlanView.mesocycles.length > 0
			? cyclePlanView.mesocycles
			: autoMesocyclesAsView(microcycles, entries);
	const cyclePlanForCalc: CyclePlan = cyclePlan
		? normalizeCyclePlan(cyclePlan)
		: {
				version: 1,
				updatedAt: '',
				templates: bundledProtocolTemplates(),
				macrocycles: [],
				mesocycles: []
			};

	return {
		entries,
		summary: computed.summary,
		trend: computed.trend,
		sessions: database.sessions,
		updatedAt: database.updatedAt,
		microcycles,
		cyclePlan,
		cyclePlanForCalc,
		cyclePlanView: { ...cyclePlanView, mesocycles },
		allDates,
		templates: cyclePlanForCalc.templates,
		protocolTemplates: cyclePlanForCalc.templates,
		workoutTemplates: microcycles.templates
	};
}

class WorkoutStore {
	database = $state.raw<WorkoutDatabase>(emptyDatabase());
	cyclePlan = $state.raw<CyclePlan | null>(normalizeLoadedCyclePlan(loadCyclePlan()));
	sync = $state<SyncState>({
		sha: null,
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

	bootstrap(bundled: WorkoutDatabase) {
		const local = loadLocalDatabase();
		const initial = pickNewerDatabase(bundled, local);
		const source =
			local && Date.parse(local.updatedAt) > Date.parse(bundled.updatedAt || '0') ? 'local' : 'bundled';
		this.applyDatabase(initial, source);
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
		const next = { ...db, updatedAt: new Date().toISOString() };
		this.database = next;
		saveLocalDatabase(next);
		this.patchSync({
			source: this.sync.source === 'github' ? 'github' : 'local'
		});
		return next;
	}

	private persistCyclePlan(plan: CyclePlan) {
		const next = { ...plan, updatedAt: new Date().toISOString() };
		this.cyclePlan = next;
		saveCyclePlan(next);
	}

	private async persistToGitHub(token: string, db: WorkoutDatabase, message: string) {
		let sha = this.sync.sha;
		if (!sha) {
			const remote = await fetchWorkoutDatabase(token);
			sha = remote.sha;
		}

		const nextSha = await saveWorkoutDatabase(token, db, sha, message);
		this.patchSync({
			sha: nextSha,
			source: 'github',
			error: '',
			message: 'Сохранено в GitHub. Сайт обновится через 1–2 минуты.'
		});
	}

	private async persistDatabase(message: string) {
		const db = this.persistLocally(this.database);
		const token = getGitHubToken();
		if (token) {
			await this.persistToGitHub(token, db, message);
		} else {
			this.patchSync({
				error: '',
				message: 'Сохранено локально в браузере.'
			});
		}
	}

	async saveSession(
		session: WorkoutSession,
		context?: { mesoId: string; microId: string }
	) {
		const db = this.database;
		const index = db.sessions.findIndex((item) => item.id === session.id);
		const sessions =
			index === -1
				? [...db.sessions, session]
				: db.sessions.map((item) => (item.id === session.id ? session : item));

		this.database = { ...db, sessions };
		await this.persistDatabase(`Update workout: ${session.exercise} (${session.date})`);

		if (!context?.mesoId || !context?.microId) return;

		const plan = this.cyclePlan;
		if (!plan) return;

		const next = assignSessionToMicro(plan, context.mesoId, context.microId, session.date);
		if (next !== plan) this.persistCyclePlan(next);
	}

	async deleteSession(sessionId: string) {
		const db = this.database;
		const target = db.sessions.find((item) => item.id === sessionId);
		this.database = { ...db, sessions: db.sessions.filter((item) => item.id !== sessionId) };
		await this.persistDatabase(`Delete workout: ${target?.exercise ?? sessionId}`);
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
		this.persistCyclePlan(refreshAllMesoAnchors(plan, this.view.entries, keepManual));
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
			const { db: remote, sha } = await fetchWorkoutDatabase(token);
			const local = loadLocalDatabase();
			const current = this.database;
			const best = [current, local, remote]
				.filter((item): item is WorkoutDatabase => item !== null)
				.reduce((winner, item) => pickNewerDatabase(winner, item));

			this.applyDatabase(best, best === remote ? 'github' : this.sync.source);
			saveLocalDatabase(best);

			this.sync = {
				sha,
				githubLogin: login,
				syncing: false,
				error: '',
				message:
					best === remote
						? 'Подключено к GitHub. Загружены данные из репозитория.'
						: 'Подключено к GitHub. Локальные данные новее — при сохранении отправятся в репозиторий.',
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
		await this.persistToGitHub(token, this.database, 'Sync workouts from app');
	}
}

export const workoutStore = new WorkoutStore();

export async function connectGitHub(token: string) {
	await workoutStore.connectGitHub(token);
}

export function bootstrapWorkoutStore(bundled: WorkoutDatabase) {
	workoutStore.bootstrap(bundled);
}

export async function refreshFromGitHub(token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token');
	await connectGitHub(token);
}

export async function pushToGitHub(token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token');
	await workoutStore.pushToGitHub(token);
}

export async function saveSession(
	session: WorkoutSession,
	context?: { mesoId: string; microId: string }
) {
	await workoutStore.saveSession(session, context);
}

export async function deleteSession(sessionId: string) {
	await workoutStore.deleteSession(sessionId);
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

export function clearCyclePlanState() {
	workoutStore.clearCyclePlanState();
}
