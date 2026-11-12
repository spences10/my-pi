import * as v from 'valibot';

// Deliberately synthetic secret-shaped data, never a real credential.
const secret = 'sk-synthetic-worker-diagnostic-1234567890';
const password_value = 'synthetic-boundary-value-1234567890';
let buffer = '';

const command_schema = v.object({
	type: v.string(),
	id: v.string(),
	message: v.optional(v.string()),
});

const send = (value: object) =>
	process.stdout.write(JSON.stringify(value) + '\n');

const crash = () =>
	process.stderr.write(`Worker diagnostic: ${secret}`, () =>
		process.exit(7),
	);

async function crash_diagnostic(mode: string) {
	// Exactly 4000 trailing characters follow the password= label. Keeping
	// only that tail would lose the label needed to recognize this value.
	const padding = '\n' + 'x'.repeat(4000 - password_value.length - 1);
	let chunks: string[];

	if (mode === 'split-stderr')
		chunks = [
			'pass',
			'word=',
			password_value.slice(0, 12),
			password_value.slice(12),
		];
	else
		chunks =
			mode === 'split-overflow-stderr'
				? ['password=', password_value, padding]
				: ['password=' + password_value + padding];

	for (const chunk of chunks) {
		await new Promise<void>((resolve) => {
			process.stderr.write(chunk, () => setTimeout(resolve, 20));
		});
	}

	process.exit(7);
}

process.stdin.setEncoding('utf8');

process.stdin.on('data', (data) => {
	buffer += data;
	let index: number;

	while ((index = buffer.indexOf('\n')) >= 0) {
		const command = v.parse(
			command_schema,
			JSON.parse(buffer.slice(0, index)),
		);

		buffer = buffer.slice(index + 1);

		const diagnostic_mode =
			command.type === 'get_state'
				? process.argv
						.find((arg) => arg.startsWith('--diagnostic-mode='))
						?.slice('--diagnostic-mode='.length)
				: command.message;

		if (
			diagnostic_mode &&
			[
				'split-stderr',
				'overflow-stderr',
				'split-overflow-stderr',
			].includes(diagnostic_mode)
		) {
			void crash_diagnostic(diagnostic_mode);
			continue;
		}

		if (
			(command.type === 'get_state' &&
				process.argv.includes('--startup-error')) ||
			command.message === 'crash'
		) {
			crash();
			continue;
		}

		const rejected = command.message === 'reject';
		send({
			type: 'response',
			id: command.id,
			command: command.type,
			success: !rejected,
			error: rejected ? `Prompt refused: ${secret}` : undefined,
			data:
				command.type === 'get_state'
					? {
							sessionId: 'diagnostic-' + process.pid,
							sessionFile: '/tmp/diagnostic.jsonl',
						}
					: { disposition: 'handled' },
		});

		if (command.message === 'result' || command.message === 'error') {
			send({ type: 'agent_start' });
			send({
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: `Report: ${secret}` }],
					stopReason: command.message === 'error' ? 'error' : 'stop',
					errorMessage: `Provider diagnostic: ${secret}`,
				},
			});
			send({ type: 'agent_settled', aborted: false });
		}
	}
});

process.stdin.on('end', () => process.exit(0));
