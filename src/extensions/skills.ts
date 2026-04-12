import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { SkillsManager } from '../skills/manager.js';

export function create_skills_extension(mgr: SkillsManager): ExtensionFactory {
	return async (pi) => {

		// Feed only explicitly enabled skills into pi
		pi.on('resources_discover', () => ({
			skillPaths: mgr.get_enabled_skill_paths(),
		}));

		const subs = [
			'discover',
			'enable',
			'disable',
			'toggle',
			'search',
			'refresh',
			'defaults',
		];

		pi.registerCommand('skills', {
			description: 'Discover and manage skills',
			getArgumentCompletions: (prefix) => {
				const parts = prefix.trim().split(/\s+/);
				if (parts.length <= 1) {
					return subs
						.filter((s) => s.startsWith(parts[0] || ''))
						.map((s) => ({ value: s, label: s }));
				}
				if (['enable', 'disable', 'toggle'].includes(parts[0])) {
					const q = parts.slice(1).join(' ').toLowerCase();
					return mgr
						.discover()
						.filter((s) => s.key.toLowerCase().includes(q))
						.slice(0, 20)
						.map((s) => ({
							value: `${parts[0]} ${s.key}`,
							label: `${s.key} ${s.enabled ? '[on]' : '[off]'}`,
						}));
				}
				return null;
			},
			handler: async (args, ctx) => {
				const [sub, ...rest] = args.trim().split(/\s+/);
				const arg = rest.join(' ');

				switch (sub || 'discover') {
					case 'discover': {
						const skills = mgr.discover();
						if (skills.length === 0) {
							ctx.ui.notify('No skills found');
							return;
						}
						const on = skills.filter((s) => s.enabled).length;
						const off = skills.length - on;
						const lines: string[] = [
							`${skills.length} skills (${on} enabled, ${off} disabled)\n`,
						];
						for (const s of skills) {
							lines.push(`  ${s.enabled ? '+' : '-'} ${s.key}`);
							lines.push(`    ${s.description.slice(0, 80)}`);
						}
						ctx.ui.notify(lines.join('\n'));
						break;
					}
					case 'enable': {
						if (!arg) {
							ctx.ui.notify('Usage: /skills enable <key>', 'warning');
							return;
						}
						mgr.enable(arg);
						ctx.ui.notify(`Enabled ${arg}. /reload to apply.`);
						break;
					}
					case 'disable': {
						if (!arg) {
							ctx.ui.notify('Usage: /skills disable <key>', 'warning');
							return;
						}
						mgr.disable(arg);
						ctx.ui.notify(`Disabled ${arg}. /reload to apply.`);
						break;
					}
					case 'toggle': {
						if (!arg) {
							ctx.ui.notify('Usage: /skills toggle <key>', 'warning');
							return;
						}
						const state = mgr.toggle(arg);
						ctx.ui.notify(
							`${arg} ${state ? 'enabled' : 'disabled'}. /reload to apply.`,
						);
						break;
					}
					case 'search': {
						if (!arg) {
							ctx.ui.notify('Usage: /skills search <query>', 'warning');
							return;
						}
						const results = mgr.search(arg);
						if (results.length === 0) {
							ctx.ui.notify(`No skills matching "${arg}"`);
							return;
						}
						const lines = results.map(
							(s) =>
								`${s.enabled ? '+' : '-'} ${s.key}\n    ${s.description.slice(0, 80)}`,
						);
						ctx.ui.notify(`${results.length} matches:\n  ${lines.join('\n  ')}`);
						break;
					}
					case 'refresh': {
						mgr.refresh();
						ctx.ui.notify(`Rescanned: ${mgr.discover().length} skills found`);
						break;
					}
					case 'defaults': {
						if (arg !== 'all-enabled' && arg !== 'all-disabled') {
							ctx.ui.notify(
								'Usage: /skills defaults <all-enabled|all-disabled>',
								'warning',
							);
							return;
						}
						mgr.set_defaults(arg);
						ctx.ui.notify(`Default policy: ${arg}`);
						break;
					}
					default:
						ctx.ui.notify(
							`Unknown: ${sub}. Use: ${subs.join(', ')}`,
							'warning',
						);
				}
			},
		});
	};
}
