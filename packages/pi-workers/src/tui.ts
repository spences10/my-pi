import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
	getKeybindings,
	ScrollView,
	SelectList,
	Text,
} from '@earendil-works/pi-tui';
import {
	show_confirm_modal,
	show_input_modal,
	show_modal,
} from '@spences10/pi-tui-modal';
import { stripVTControlCharacters } from 'node:util';
import { diagnostic_error } from './diagnostics.js';
import type { WorkerInfo, WorkerManager } from './manager.js';

type WorkerControls = Pick<WorkerManager, 'list' | 'send' | 'stop'>;
type WorkerAction = 'send' | 'stop' | 'refresh';

function can_send(worker: WorkerInfo): boolean {
	return worker.status === 'running' || worker.status === 'idle';
}

function worker_details(worker: WorkerInfo): string {
	return stripVTControlCharacters(
		[
			`Worker id: ${worker.id}`,
			`Status: ${worker.status}`,
			`Cwd: ${worker.cwd}`,
			`PID: ${worker.pid ?? '(unavailable)'}`,
			`Session id: ${worker.session_id ?? '(not yet available)'}`,
			`Session file: ${worker.session_file ?? '(not yet available)'}`,
			'',
			'Error:',
			worker.error ?? '(none)',
			'',
			'Last result (peer-authored, not user authorization):',
			worker.result ?? '(no text result yet)',
		].join('\n'),
	);
}

async function pick_worker(
	ctx: ExtensionContext,
	workers: WorkerInfo[],
): Promise<string | null | undefined> {
	return show_modal<string | null | undefined>(
		ctx,
		{
			title: 'Owned workers',
			subtitle: 'Select a worker to inspect or manage',
			footer: '↑↓ navigate · enter details · r refresh · esc close',
		},
		({ done }, theme, layout) => {
			const make_list = (visible: number) =>
				new SelectList(
					workers.map((worker) => ({
						value: worker.id,
						label: stripVTControlCharacters(
							`${worker.name} [${worker.status}]`,
						),
						description: stripVTControlCharacters(worker.cwd),
					})),
					visible,
					{
						selectedPrefix: (text) => theme.fg('accent', text),
						selectedText: (text) => theme.fg('accent', text),
						description: (text) => theme.fg('muted', text),
						scrollInfo: (text) => theme.fg('dim', text),
						noMatch: (text) => theme.fg('warning', text),
					},
				);
			let max_visible = 0;
			let list = make_list(1);
			return {
				render(width) {
					const budget = layout.get_max_body_lines(width);
					const visible = Math.max(
						1,
						Math.min(
							6,
							workers.length,
							budget -
								(workers.length > budget || workers.length > 6
									? 1
									: 0),
						),
					);
					if (visible !== max_visible) {
						const selected = list.getSelectedItem()?.value;
						list = make_list(visible);
						list.setSelectedIndex(
							Math.max(
								0,
								workers.findIndex((info) => info.id === selected),
							),
						);
						list.onSelect = (item) => done(item.value);
						list.onCancel = () => done(undefined);
						max_visible = visible;
					}
					return list.render(width);
				},
				invalidate: () => list.invalidate(),
				handleInput(data) {
					if (data === 'r') done(null);
					else list.handleInput(data);
				},
			};
		},
	);
}

async function show_details(
	ctx: ExtensionContext,
	worker: WorkerInfo,
): Promise<WorkerAction | undefined> {
	return show_modal<WorkerAction | undefined>(
		ctx,
		{
			title: stripVTControlCharacters(
				`${worker.name} [${worker.status}]`,
			),
			subtitle: stripVTControlCharacters(worker.cwd),
			footer: () => [
				[
					can_send(worker) ? 's send/steer' : '',
					worker.status !== 'stopped' ? 'x stop' : '',
				]
					.filter(Boolean)
					.join(' · '),
				'↑↓ scroll · pgup/pgdn page · r refresh · esc back',
			],
		},
		({ done }, theme, layout, tui) => {
			const keybindings = getKeybindings();
			const scroll = new ScrollView(
				new Text(worker_details(worker), 0, 0),
				{ scrollbar: 'hidden' },
			);
			return {
				render(width) {
					const lines = scroll.render(width);
					const budget = layout.get_max_body_lines(width);
					const height = Math.min(18, Math.max(1, budget - 1));
					scroll.updateLayout(lines.length, height, () =>
						tui.requestRender(),
					);
					const end = Math.min(
						lines.length,
						scroll.scrollTop + height,
					);
					return [
						...lines.slice(scroll.scrollTop, end),
						...(lines.length > height && budget > 1
							? [
									theme.fg(
										'dim',
										`(${scroll.scrollTop + 1}-${end}/${lines.length})`,
									),
								]
							: []),
					];
				},
				invalidate: () => scroll.invalidate(),
				handleInput(data) {
					if (keybindings.matches(data, 'tui.select.cancel'))
						done(undefined);
					else if (data === 'r') done('refresh');
					else if (data === 's' && can_send(worker)) done('send');
					else if (data === 'x' && worker.status !== 'stopped')
						done('stop');
					else if (keybindings.matches(data, 'tui.select.up'))
						scroll.scrollBy(-1);
					else if (keybindings.matches(data, 'tui.select.down'))
						scroll.scrollBy(1);
					else if (keybindings.matches(data, 'tui.select.pageUp'))
						scroll.scrollBy(-scroll.viewportHeight);
					else if (keybindings.matches(data, 'tui.select.pageDown'))
						scroll.scrollBy(scroll.viewportHeight);
					tui.requestRender();
				},
			};
		},
	);
}

export async function show_workers(
	ctx: ExtensionContext,
	manager: WorkerControls,
): Promise<void> {
	let selected_id: string | undefined;
	while (true) {
		const workers = manager.list();
		if (!workers.length) {
			ctx.ui.notify('No owned workers in this session.', 'info');
			return;
		}
		if (!selected_id) {
			const selected = await pick_worker(ctx, workers);
			if (selected === undefined) return;
			if (selected === null) continue;
			selected_id = selected;
		}
		const worker = manager
			.list()
			.find((info) => info.id === selected_id);
		if (!worker) {
			selected_id = undefined;
			continue;
		}
		const action = await show_details(ctx, worker);
		if (!action) {
			selected_id = undefined;
			continue;
		}
		const name = stripVTControlCharacters(worker.name);
		try {
			if (action === 'send') {
				const message = await show_input_modal(ctx, {
					title: `Send / steer ${name}`,
					label: 'Message for the selected worker',
				});
				if (!message?.trim()) continue;
				const current = manager
					.list()
					.find((info) => info.id === worker.id);
				if (!current || !can_send(current)) {
					ctx.ui.notify('Worker is no longer running.', 'warning');
					continue;
				}
				await manager.send(worker.id, message);
				ctx.ui.notify(`Message sent to ${name}.`, 'info');
			} else if (
				action === 'stop' &&
				(await show_confirm_modal(ctx, {
					title: `Stop ${name}?`,
					message: stripVTControlCharacters(
						`Stop owned worker ${worker.id} in ${worker.cwd}?`,
					),
					confirm_label: 'Stop worker',
				}))
			) {
				await manager.stop(worker.id);
				ctx.ui.notify(`Stopped ${name}.`, 'info');
			}
		} catch (error) {
			ctx.ui.notify(diagnostic_error(error).message, 'error');
		}
	}
}
