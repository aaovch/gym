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
};

type ThesesLocalOverlay = {
	disabledIds: string[];
	customGroups: TrainingThesisGroup[];
};

const LOCAL_KEY = 'gym_training_theses';

function emptyDoc(): TrainingThesesDoc {
	return { version: 1, updatedAt: '', groups: [] };
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

	bootstrap(doc: TrainingThesesDoc) {
		this.bundled = doc;
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
