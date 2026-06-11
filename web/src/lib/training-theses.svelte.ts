import { browser } from '$app/environment';

export type TrainingThesis = {
	id: string;
	text: string;
	tags?: string[];
	note?: string;
};

export type TrainingThesisGroup = {
	id: string;
	title: string;
	source?: string;
	tags?: string[];
	theses: TrainingThesis[];
};

export type TrainingThesesDoc = {
	version: 1;
	updatedAt: string;
	groups: TrainingThesisGroup[];
	matrices?: IntensityAdaptationMatrix[];
};

export type IntensityBand = {
	id: string;
	label: string;
	fromPct: number;
	toPct: number;
};

export type AdaptationIntensityRow = {
	id: string;
	label: string;
	/** Звёзды по колонкам (1–maxStars): чем больше, тем лучше проходит адаптация. */
	stars: number[];
};

export type IntensityAdaptationMatrix = {
	id: string;
	title: string;
	note?: string;
	maxStars?: number;
	bands: IntensityBand[];
	rows: AdaptationIntensityRow[];
};

type ThesesLocalOverlay = {
	disabledIds: string[];
	customGroups: TrainingThesisGroup[];
};

const LOCAL_KEY = 'gym_training_theses';

function emptyDoc(): TrainingThesesDoc {
	return { version: 1, updatedAt: '', groups: [], matrices: [] };
}

function emptyOverlay(): ThesesLocalOverlay {
	return { disabledIds: [], customGroups: [] };
}

function loadOverlay(): ThesesLocalOverlay {
	if (!browser) return emptyOverlay();
	try {
		const raw = localStorage.getItem(LOCAL_KEY);
		if (!raw) return emptyOverlay();
		const parsed = JSON.parse(raw) as Partial<ThesesLocalOverlay>;
		return {
			disabledIds: parsed.disabledIds ?? [],
			customGroups: parsed.customGroups ?? []
		};
	} catch {
		return emptyOverlay();
	}
}

function saveOverlay(overlay: ThesesLocalOverlay) {
	if (!browser) return;
	localStorage.setItem(LOCAL_KEY, JSON.stringify(overlay));
}

function mergeGroups(bundled: TrainingThesesDoc, overlay: ThesesLocalOverlay): TrainingThesisGroup[] {
	const disabled = new Set(overlay.disabledIds);
	const filterGroup = (group: TrainingThesisGroup): TrainingThesisGroup | null => {
		const theses = group.theses.filter((thesis) => !disabled.has(thesis.id));
		if (theses.length === 0) return null;
		return { ...group, theses };
	};

	const bundledGroups = bundled.groups
		.map(filterGroup)
		.filter((group): group is TrainingThesisGroup => group !== null);

	const customGroups = overlay.customGroups
		.map(filterGroup)
		.filter((group): group is TrainingThesisGroup => group !== null);

	return [...bundledGroups, ...customGroups];
}

class TrainingThesesStore {
	bundled = $state.raw<TrainingThesesDoc>(emptyDoc());
	overlay = $state.raw<ThesesLocalOverlay>(loadOverlay());

	groups = $derived.by(() => mergeGroups(this.bundled, this.overlay));

	matrices = $derived.by(() => this.bundled.matrices ?? []);

	bootstrap(doc: TrainingThesesDoc) {
		this.bundled = doc;
	}

	/** Звёзды адаптации при заданном %1ПМ (для подсказок в плане). */
	starsAtPct(matrixId: string, adaptationId: string, pct: number): number | null {
		const matrix = this.matrices.find((item) => item.id === matrixId);
		if (!matrix) return null;
		const row = matrix.rows.find((item) => item.id === adaptationId);
		if (!row) return null;
		const bandIndex = matrix.bands.findIndex((band, index) => {
			const isLast = index === matrix.bands.length - 1;
			if (pct < band.fromPct) return false;
			return isLast ? pct <= band.toPct : pct < band.toPct;
		});
		if (bandIndex === -1) return null;
		return row.stars[bandIndex] ?? null;
	}

	allTheses = $derived.by(() =>
		this.groups.flatMap((group) =>
			group.theses.map((thesis) => ({
				...thesis,
				groupId: group.id,
				groupTitle: group.title
			}))
		)
	);

	byTag(tag: string) {
		return this.allTheses.filter((thesis) => thesis.tags?.includes(tag));
	}

	setThesisEnabled(id: string, enabled: boolean) {
		const disabled = new Set(this.overlay.disabledIds);
		if (enabled) disabled.delete(id);
		else disabled.add(id);
		this.overlay = { ...this.overlay, disabledIds: [...disabled] };
		saveOverlay(this.overlay);
	}

	addCustomGroup(group: TrainingThesisGroup) {
		this.overlay = {
			...this.overlay,
			customGroups: [...this.overlay.customGroups, group]
		};
		saveOverlay(this.overlay);
	}

	resetLocal() {
		this.overlay = emptyOverlay();
		saveOverlay(this.overlay);
	}
}

export const thesesStore = new TrainingThesesStore();

export function bootstrapTheses(doc: TrainingThesesDoc) {
	thesesStore.bootstrap(doc);
}

export function formatAdaptationStars(stars: number, maxStars = 4): string {
	const safe = Math.max(0, Math.min(maxStars, Math.round(stars)));
	return `${'★'.repeat(safe)}${'☆'.repeat(maxStars - safe)}`;
}
