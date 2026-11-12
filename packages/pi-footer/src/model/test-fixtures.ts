import type { Usage } from '@earendil-works/pi-ai';
import {
	SessionManager,
	type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { make_assistant_message } from '../../../../tools/test-sdk.js';

export function make_usage(
	overrides: Partial<Omit<Usage, 'cost'>> & {
		cost?: Partial<Usage['cost']>;
	},
): Usage {
	const defaults = make_assistant_message().usage;

	return {
		...defaults,
		...overrides,
		cost: { ...defaults.cost, ...overrides.cost },
	};
}

export function make_usage_entry(
	kind: 'assistant' | 'toolResult' | 'compaction' | 'branch_summary',
	usage: Usage,
): SessionEntry {
	const base = {
		id: kind,
		parentId: null,
		timestamp: new Date(0).toISOString(),
	};

	switch (kind) {
		case 'assistant':
			return {
				...base,
				type: 'message',
				message: make_assistant_message({ usage }),
			};
		case 'toolResult':
			return {
				...base,
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'call',
					toolName: 'test',
					content: [],
					isError: false,
					timestamp: 0,
					usage,
				},
			};
		case 'compaction':
			return {
				...base,
				type: 'compaction',
				summary: '',
				firstKeptEntryId: 'kept',
				tokensBefore: 0,
				usage,
			};
		case 'branch_summary':
			return {
				...base,
				type: 'branch_summary',
				fromId: 'branch',
				summary: '',
				usage,
			};
	}
}

export function make_thinking_entries(
	...levels: string[]
): SessionEntry[] {
	const manager = SessionManager.inMemory('/repo');

	for (const level of levels)
		manager.appendThinkingLevelChange(level);

	return manager.getEntries();
}
