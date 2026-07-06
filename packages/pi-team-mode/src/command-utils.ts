import type { BeforeAgentStartEvent } from '@earendil-works/pi-coding-agent';

export function should_inject_team_prompt(
	event: Partial<Pick<BeforeAgentStartEvent, 'systemPromptOptions'>>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.includes('team');
}

export function append_team_system_prompt(
	base_prompt: string,
	options: {
		coordination_identity?: string;
	},
): string {
	const coordination_identity = options.coordination_identity
		? `\n\n${options.coordination_identity}`
		: '';

	return (
		base_prompt +
		`

## Team Mode

Peer-session coordination is available through the \`team\` tool.${coordination_identity}
Use the \`team\` tool as the source of truth for peer-session coordination.

Rules:
- Every my-pi session registers in the global coordination bus. Use session_list to discover sessions across projects before sending peer messages.
- If the user mentions standby sessions, existing sessions, subordinates, handoffs, or other active sessions, call session_list and prefer registered standby sessions.
- Inbox states are separate: delivered means queued to a session, read means reviewed, acknowledged means fully processed and safe to suppress redelivery. Use session_read after reviewing peer messages and session_ack after acting on them.
- Use artifact_create, artifact_get, and artifact_list for larger handoffs, plans, findings, logs, diffs, or results; send artifact ids instead of large mailbox bodies.
- Use group_create, group_add_session, and group_send when one session should coordinate a group of independently running sessions.
- Use urgent peer messaging for coordination instead of assuming shared context.`
	);
}
