import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { create_extensions_extension } from './index.js';

function create_test_pi() {
	const commands = new Map<string, any>();
	const pi = {
		registerCommand(name: string, definition: any) {
			commands.set(name, definition);
		},
	} as unknown as ExtensionAPI;
	return { pi, commands };
}

function create_command_context(options?: { hasUI?: boolean }) {
	const notifications: Array<{ message: string; level?: string }> =
		[];
	let custom_calls = 0;
	let reload_calls = 0;

	return {
		ctx: {
			hasUI: options?.hasUI ?? true,
			ui: {
				notify(message: string, level?: string) {
					notifications.push({ message, level });
				},
				async custom() {
					custom_calls += 1;
				},
			},
			async reload() {
				reload_calls += 1;
			},
		} as any,
		notifications,
		get custom_calls() {
			return custom_calls;
		},
		get reload_calls() {
			return reload_calls;
		},
	};
}

const dirs: string[] = [];
const original_xdg = process.env.XDG_CONFIG_HOME;

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	if (original_xdg === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = original_xdg;
	}
});

describe('extensions command', () => {
	it.each(['enable', 'disable', 'toggle'])(
		'opens the interactive manager for /extensions %s with no key in UI mode',
		async (subcommand) => {
			const config_home = mkdtempSync(
				join(tmpdir(), 'my-pi-ext-test-'),
			);
			dirs.push(config_home);
			process.env.XDG_CONFIG_HOME = config_home;

			const { pi, commands } = create_test_pi();
			await create_extensions_extension()(pi);

			const command = commands.get('extensions');
			expect(command).toBeTruthy();

			const command_context = create_command_context({ hasUI: true });
			await command.handler(subcommand, command_context.ctx);

			expect(command_context.custom_calls).toBe(1);
			expect(command_context.reload_calls).toBe(0);
			expect(
				command_context.notifications.some((entry) =>
					entry.message.includes('Usage: /extensions'),
				),
			).toBe(false);
		},
	);

	it('keeps the usage warning for /extensions toggle with no key outside UI mode', async () => {
		const config_home = mkdtempSync(
			join(tmpdir(), 'my-pi-ext-test-'),
		);
		dirs.push(config_home);
		process.env.XDG_CONFIG_HOME = config_home;

		const { pi, commands } = create_test_pi();
		await create_extensions_extension()(pi);

		const command = commands.get('extensions');
		expect(command).toBeTruthy();

		const command_context = create_command_context({ hasUI: false });
		await command.handler('toggle', command_context.ctx);

		expect(command_context.custom_calls).toBe(0);
		expect(command_context.notifications).toContainEqual({
			message: 'Usage: /extensions toggle <key>',
			level: 'warning',
		});
	});
});
