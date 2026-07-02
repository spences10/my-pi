export type StandbyIntent =
	| 'subordinate'
	| 'handoff-target'
	| 'standby';

export interface StandbyRegistration {
	availability: 'standby';
	intent: StandbyIntent;
	alias?: string;
}

function normalize_text(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function detect_standby_registration(
	text: string | undefined,
): StandbyRegistration | undefined {
	if (!text) return undefined;
	const normalized = normalize_text(text);
	if (!normalized) return undefined;

	const mentions_standby = /\bstand\s*by\b|\bstandby\b/.test(
		normalized,
	);
	const mentions_subordinate =
		/\bsubordinate\b|\bsubordonate\b|\bteammate\b/.test(normalized);
	const mentions_handoff = /\bhandoff\b|\btake over\b/.test(
		normalized,
	);
	const mentions_coordination =
		/\bcoordination session\b|\bcoordinator session\b/.test(
			normalized,
		);
	const mentions_orchestrator = /\borchestrator\b/.test(normalized);

	if (
		!mentions_standby &&
		!mentions_subordinate &&
		!mentions_handoff &&
		!mentions_coordination
	) {
		return undefined;
	}

	const intent: StandbyIntent = mentions_handoff
		? 'handoff-target'
		: mentions_subordinate || mentions_orchestrator
			? 'subordinate'
			: 'standby';

	return {
		availability: 'standby',
		intent,
	};
}

export function is_standby_session(
	metadata: Record<string, unknown>,
): boolean {
	return metadata.availability === 'standby';
}

export function standby_label(
	metadata: Record<string, unknown>,
): string | undefined {
	if (!is_standby_session(metadata)) return undefined;
	const intent =
		typeof metadata.intent === 'string' ? metadata.intent : 'standby';
	const alias =
		typeof metadata.alias === 'string' ? metadata.alias : undefined;
	return alias
		? `standby:${intent} as ${alias}`
		: `standby:${intent}`;
}
