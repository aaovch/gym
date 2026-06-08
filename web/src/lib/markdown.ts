import type { WorkoutEntry } from './types';

export type SetPair = [number, number];

export type DraftRow = {
	date: string | null;
	sets: SetPair[];
	comment?: string;
};

export type DraftEntry = {
	exercise: string;
	rows: DraftRow[];
};

const SET_RE = /^\s*([\d.,]+)\s*[x×]\s*([\d.,]+)\s*$/i;

export function parseSetsText(text: string): SetPair[] {
	const cleaned = text.replace(/\([^)]*\)/g, '');
	const parts = cleaned
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	const result: SetPair[] = [];

	for (const part of parts) {
		const match = SET_RE.exec(part);
		if (!match) continue;
		result.push([
			Number(match[1].replace(',', '.')),
			Number(match[2].replace(',', '.'))
		]);
	}

	return result;
}

export function formatWeight(weight: number): string {
	if (Number.isInteger(weight)) return String(weight);
	return weight.toFixed(1).replace('.', ',');
}

export function formatSet(weight: number, reps: number): string {
	return `${formatWeight(weight)}×${formatWeight(reps)}`;
}

export function formatSetsCell(sets: SetPair[], comment?: string): string {
	const body = sets.map(([weight, reps]) => formatSet(weight, reps)).join(', ');
	if (!comment?.trim()) return body;
	return `${body} (${comment.trim()})`;
}

export function formatTableRow(date: string | null, setsCell: string): string {
	const dateCell = date ? date : '';
	return `| ${dateCell.padEnd(10)} | ${setsCell} |`;
}

export function draftToMarkdownRows(draft: DraftEntry): string[] {
	return draft.rows.map((row) => formatTableRow(row.date, formatSetsCell(row.sets, row.comment)));
}

export function appendDraftToMarkdown(markdown: string, draft: DraftEntry): string {
	const rows = draftToMarkdownRows(draft);
	const exerciseHeader = `### ${draft.exercise}`;
	const headerIndex = markdown.indexOf(exerciseHeader);

	if (headerIndex === -1) {
		const block = [
			'',
			exerciseHeader,
			'',
			'| Дата       | Подходы (Вес × Повт) |',
			'| ---------- | --------------------- |',
			...rows,
			''
		].join('\n');
		return `${markdown.replace(/\s*$/, '')}\n${block}`;
	}

	const afterHeader = markdown.slice(headerIndex + exerciseHeader.length);
	const nextHeading = afterHeader.search(/\n(?:### |## )/);
	const sectionEnd = nextHeading === -1 ? markdown.length : headerIndex + exerciseHeader.length + nextHeading;
	const section = markdown.slice(headerIndex, sectionEnd);
	const lines = section.split('\n');

	let lastTableRow = -1;
	for (let i = 0; i < lines.length; i += 1) {
		if (/^\|\s*(\d{4}-\d{2}-\d{2}|\s*)\|/.test(lines[i])) {
			lastTableRow = i;
		}
	}

	if (lastTableRow === -1) {
		const tableStart = [
			'',
			'| Дата       | Подходы (Вес × Повт) |',
			'| ---------- | --------------------- |',
			...rows
		];
		const updatedSection = [exerciseHeader, ...tableStart, ...lines.slice(1)].join('\n');
		return markdown.slice(0, headerIndex) + updatedSection + markdown.slice(sectionEnd);
	}

	const updatedLines = [...lines.slice(0, lastTableRow + 1), ...rows, ...lines.slice(lastTableRow + 1)];
	const updatedSection = updatedLines.join('\n');
	return markdown.slice(0, headerIndex) + updatedSection + markdown.slice(sectionEnd);
}

export function draftToWorkoutParts(draft: DraftEntry): WorkoutEntry[] {
	const result: WorkoutEntry[] = [];
	let currentDate: string | null = null;

	for (const row of draft.rows) {
		if (row.date) currentDate = row.date;
		if (!currentDate) continue;
		result.push({
			exercise: draft.exercise,
			date: currentDate,
			parts: [formatSetsCell(row.sets, row.comment)],
			sets: row.sets
		});
	}

	return result;
}
