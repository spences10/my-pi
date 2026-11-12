import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [role, mode, directory] = process.argv.slice(2);

process.title = 'pi ) (tree)';

const send = (record: object) =>
	process.stdout.write(JSON.stringify(record) + '\n');

if (role === 'descendant') {
	process.on('SIGTERM', () => {
		writeFileSync(join(directory, 'term'), String(Date.now()));

		if (mode !== 'stubborn') process.exit(0);
	});
	setInterval(() => {}, 1000);
	writeFileSync(
		join(directory, 'identity'),
		readFileSync('/proc/self/stat', 'utf8'),
	);
	writeFileSync(join(directory, 'ready'), 'ready');
} else {
	if (mode !== 'graceful') {
		const descendant = spawn(
			process.execPath,
			[
				import.meta.filename,
				'descendant',
				mode === 'tree' ? 'graceful' : 'stubborn',
				directory,
			],
			{ stdio: 'ignore' },
		);

		writeFileSync(
			join(directory, 'descendant'),
			String(descendant.pid),
		);
		await new Promise<void>((resolve) => {
			const timer = setInterval(() => {
				if (!existsSync(join(directory, 'ready'))) return;
				clearInterval(timer);
				resolve();
			}, 5);
		});
	}

	let aborted = false;
	let buffer = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => {
		buffer += chunk;
		let index: number;

		while ((index = buffer.indexOf('\n')) >= 0) {
			const command = JSON.parse(buffer.slice(0, index));
			buffer = buffer.slice(index + 1);

			if (command.type === 'abort') aborted = true;
		}
	});
	process.stdin.on('end', () => {
		send({ type: 'shutdown', aborted });

		if (mode !== 'stubborn-owner') process.exit(0);
	});
	process.on('SIGTERM', () => {
		send({ type: 'signal', signal: 'SIGTERM' });

		if (mode !== 'stubborn-owner') process.exit(1);
	});

	if (mode === 'stubborn-owner') setInterval(() => {}, 1000);
	send({ type: 'ready' });
}
