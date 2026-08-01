export const DEFAULT_TEAM_LIST_LIMIT = 20;
export const MAX_TEAM_LIST_LIMIT = 100;

export interface TeamPaginationInput {
	limit?: number;
	offset?: number;
}

export interface TeamPaginationMetadata {
	returned_count: number;
	total_count: number;
	has_more: boolean;
	limit: number;
	offset: number;
	next_offset?: number;
}

export interface TeamPage<T> {
	items: T[];
	pagination: TeamPaginationMetadata;
}

function require_integer_in_range(
	value: number,
	name: string,
	minimum: number,
	maximum?: number,
): number {
	if (
		!Number.isInteger(value) ||
		value < minimum ||
		(maximum !== undefined && value > maximum)
	) {
		const range =
			maximum === undefined
				? `at least ${minimum}`
				: `between ${minimum} and ${maximum}`;
		throw new Error(`Team ${name} must be an integer ${range}.`);
	}
	return value;
}

export function paginate_team_items<T>(
	items: T[],
	input: TeamPaginationInput = {},
): TeamPage<T> {
	const limit = require_integer_in_range(
		input.limit ?? DEFAULT_TEAM_LIST_LIMIT,
		'limit',
		1,
		MAX_TEAM_LIST_LIMIT,
	);
	const offset = require_integer_in_range(
		input.offset ?? 0,
		'offset',
		0,
	);
	const page_items = items.slice(offset, offset + limit);
	const has_more = offset + page_items.length < items.length;
	return {
		items: page_items,
		pagination: {
			returned_count: page_items.length,
			total_count: items.length,
			has_more,
			limit,
			offset,
			...(has_more
				? { next_offset: offset + page_items.length }
				: {}),
		},
	};
}

export function format_team_page(
	action: string,
	body: string,
	pagination: TeamPaginationMetadata,
	options: { warning?: string } = {},
): string {
	const summary = [
		`returned_count=${pagination.returned_count}`,
		`total_count=${pagination.total_count}`,
		`has_more=${pagination.has_more}`,
		`limit=${pagination.limit}`,
		`offset=${pagination.offset}`,
	].join(' ');
	const next = pagination.has_more
		? `Next page: repeat action=${action} with limit=${pagination.limit} offset=${pagination.next_offset}.`
		: undefined;
	return [
		options.warning ? `Warning: ${options.warning}` : undefined,
		body,
		`Pagination: ${summary}`,
		next,
	]
		.filter((line): line is string => Boolean(line))
		.join('\n');
}
