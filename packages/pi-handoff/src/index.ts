// Handoff extension — prompt shim for portable continuation workflows.
// This package does not implement commands; it teaches the model when and how to hand off.

import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
} from '@earendil-works/pi-coding-agent';

export function should_inject_handoff_prompt(event: {
	systemPromptOptions?: { selectedTools?: string[] };
}): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return (
		!selected_tools ||
		selected_tools.includes('write') ||
		selected_tools.includes('team')
	);
}

export default function handoff(pi: ExtensionAPI): void {
	pi.on(
		'before_agent_start',
		async (event: BeforeAgentStartEvent) => {
			if (!should_inject_handoff_prompt(event)) return {};
			return {
				systemPrompt:
					event.systemPrompt +
					`

## Handoff

When the user asks to hand off, park, delegate, continue later, give work to another session, or send work to a teammate, treat it as a portable continuation request.

Core behavior:
- Create a focused markdown handoff artifact, not a broad transcript summary.
- Include only context relevant to the requested follow-up task.
- Prefer the OS temp directory for disposable handoffs unless the user asks to keep it in the repo.
- Do not duplicate large content already captured in files, issues, logs, or docs; point to those artifacts instead.
- Redact secrets, credentials, tokens, passwords, and PII.
- Make the next session's task explicit and bounded.
- Include return requirements when another agent/session should come back with findings.

Suggested handoff sections:
- Purpose
- Source context
- Task
- Files and artifacts
- Decisions and constraints
- Suggested approach
- Suggested skills/tools
- Return requirements
- Validation
- Safety/redaction notes

Self handoff:
- If the user wants to resume later, write the handoff file and report its path plus a concise continuation instruction.
- Do not switch sessions unless the user explicitly asks for a fresh/new session.

Team handoff:
- If team-mode tools are available and the user names a teammate, use the team tool instead of only writing a file.
- Create or update a task, send the teammate a message with the handoff path/summary, and ask for a return handoff with findings, changed files, validation, and recommendations.
- If the user says to work in the background, go off, keep going here, or similar, spawn or prompt the teammate without blocking the current lead session.
- For implementation/prototype/refactor/test work, prefer a worktree/mutating teammate when spawning is available.

Return handoff:
- When working as a delegated session, finish by compressing findings into a return handoff for the parent/lead.
- Include what changed, what was learned, validation run, unresolved risks, and recommended next action.`,
			};
		},
	);
}
