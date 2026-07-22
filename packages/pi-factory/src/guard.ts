import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
	check_command_allowed,
	check_path_allowed,
	type HarnessContract,
} from '@spences10/pi-harness';
import { readFileSync } from 'node:fs';

const delegated_agent_command = /(^|[;&|]\s*)(pi|claude|codex)(\s|$)/;
const test_file =
	/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/;

export function create_factory_guard(contract: HarnessContract) {
	return function factory_guard(pi: ExtensionAPI): void {
		pi.on('tool_call', async (event) => {
			if (event.toolName === 'bash') {
				const command =
					(event.input as { command?: string }).command ?? '';
				if (delegated_agent_command.test(command)) {
					return {
						block: true,
						reason:
							'Owned Factory executors cannot delegate to another agent',
					};
				}
				const result = check_command_allowed(contract, command);
				if (!result.ok) return { block: true, reason: result.reason };
			}
			if (event.toolName === 'edit' || event.toolName === 'write') {
				const path = (event.input as { path?: string }).path;
				if (!path)
					return { block: true, reason: 'A target path is required' };
				if (
					!contract.scaffold.allow_test_changes &&
					test_file.test(path)
				) {
					return {
						block: true,
						reason: 'Harness policy forbids test changes',
					};
				}
				const result = check_path_allowed(contract, path);
				if (!result.ok) return { block: true, reason: result.reason };
			}
		});
	};
}

export default function factory_guard(pi: ExtensionAPI): void {
	const harness_path = process.env['PI_FACTORY_HARNESS_PATH'];
	if (!harness_path)
		throw new Error('PI_FACTORY_HARNESS_PATH is required');
	const contract = JSON.parse(
		readFileSync(harness_path, 'utf8'),
	) as HarnessContract;
	create_factory_guard(contract)(pi);
}
