export const BODY_CHUNK_SIZE = 1200;

export interface BodyChunkMetadata {
	body_length: number;
	chunk_count: number;
}

export interface BodyChunk extends BodyChunkMetadata {
	chunk_index: number;
	chunk_start: number;
	chunk_end: number;
	text: string;
}

export function body_chunk_metadata(body: string): BodyChunkMetadata {
	return {
		body_length: body.length,
		chunk_count: Math.max(
			1,
			Math.ceil(body.length / BODY_CHUNK_SIZE),
		),
	};
}

export function format_chunk_metadata(body: string): string {
	const metadata = body_chunk_metadata(body);
	return `body_length:${metadata.body_length} chunk_count:${metadata.chunk_count}`;
}

export function get_body_chunks(
	body: string,
	options: {
		chunk_index?: number;
		before?: number;
		after?: number;
	} = {},
): BodyChunk[] {
	const metadata = body_chunk_metadata(body);
	const requested = Math.min(
		Math.max(0, Math.floor(options.chunk_index ?? 0)),
		metadata.chunk_count - 1,
	);
	const before = Math.max(0, Math.floor(options.before ?? 0));
	const after = Math.max(0, Math.floor(options.after ?? 0));
	const first = Math.max(0, requested - before);
	const last = Math.min(metadata.chunk_count - 1, requested + after);
	const chunks: BodyChunk[] = [];
	for (let index = first; index <= last; index += 1) {
		const start = index * BODY_CHUNK_SIZE;
		const end = Math.min(body.length, start + BODY_CHUNK_SIZE);
		chunks.push({
			...metadata,
			chunk_index: index,
			chunk_start: start,
			chunk_end: end,
			text: body.slice(start, end),
		});
	}
	return chunks;
}

export function format_body_chunks(
	label: string,
	body: string,
	options: {
		chunk_index?: number;
		before?: number;
		after?: number;
	} = {},
): string {
	const chunks = get_body_chunks(body, options);
	return chunks
		.map(
			(chunk) =>
				`${label} chunk ${chunk.chunk_index + 1}/${chunk.chunk_count} (${chunk.chunk_start}-${chunk.chunk_end} of ${chunk.body_length})\n${chunk.text}`,
		)
		.join('\n\n');
}
