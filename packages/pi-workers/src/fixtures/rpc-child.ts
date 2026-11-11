import { spawn } from 'node:child_process';

let buffer = '';
let stubborn = false;

type Command = {
	type: string;
	id?: string;
	message?: string;
	confirmed?: boolean;
};

const send = (value: object) =>
	process.stdout.write(JSON.stringify(value) + '\n');

const response = (command: Command, data: object = {}) =>
	send({
		type: 'response',
		id: command.id,
		command: command.type,
		success: true,
		data,
	});

const complete = (text: string) => {
	send({
		type: 'message_end',
		message: {
			role: 'assistant',
			content: [{ type: 'text', text }],
			stopReason: 'stop',
		},
	});
	send({ type: 'agent_settled', aborted: false });
};

process.stdin.setEncoding('utf8');

process.stdin.on('data', (data) => {
	buffer += data;
	let index;

	while ((index = buffer.indexOf('\n')) >= 0) {
		const command: Command = JSON.parse(buffer.slice(0, index));
		buffer = buffer.slice(index + 1);

		if (command.type === 'get_state') {
			if (!process.argv.includes('--hang'))
				response(command, {
					sessionId: 'session-' + process.pid,
					sessionFile: '/tmp/session-' + process.pid + '.jsonl',
				});
		} else if (command.type === 'prompt') {
			if (command.message === 'reject') {
				send({
					type: 'response',
					id: command.id,
					success: false,
					error: 'Prompt refused',
				});
				continue;
			}

			if (command.message === 'handled') {
				response(command, { disposition: 'handled' });
				continue;
			}

			send({ type: 'agent_start' });

			if (command.message === 'crash') {
				process.exit(7);
			}

			if (command.message === 'identity') {
				complete(
					JSON.stringify({
						parent: process.env.MY_PI_TEAM_PARENT_SESSION_ID,
						group: process.env.MY_PI_TEAM_GROUP_ID,
						worker: process.env.MY_PI_WORKER_ID,
					}),
				);
				response(command, { disposition: 'started' });
				continue;
			}

			if (command.message === 'fast') {
				complete('fast result');
				response(command, { disposition: 'started' });
				continue;
			}

			response(command, { disposition: 'started' });

			if (command.message === 'wait') continue;

			if (command.message === 'stubborn') {
				stubborn = true;
				process.on('SIGTERM', () => {});

				const descendant = spawn(
					process.execPath,
					[
						'-e',
						'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
					],
					{ stdio: ['ignore', 'inherit', 'inherit'] },
				);

				complete(String(descendant.pid));
				continue;
			}

			if (command.message === 'approval') {
				send({
					type: 'extension_ui_request',
					id: 'approval',
					method: 'confirm',
					title: 'Allow probe?',
					message: 'A test approval',
				});
			} else {
				send({ type: 'agent_end' });
				setTimeout(() => {
					complete(command.message ?? '');
					send({ type: 'agent_settled', aborted: false });
				}, 25);
			}
		} else if (command.type === 'extension_ui_response') {
			complete(command.confirmed ? 'approved' : 'denied');
		} else response(command);
	}
});

process.stdin.on('end', () => {
	if (!stubborn) process.exit(0);
});
