import type { BashOperations } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	create_redactor,
	redact_data,
	redacting_bash_operations,
} from './output.js';

const token = `ghp_${'X'.repeat(36)}`;

interface CyclicFixture {
	first: { value: string };
	second: { value: string };
	self?: CyclicFixture;
}

describe('incremental direct shell backend', () => {
	it('holds incomplete text, joins UTF-8 and token chunks, strips controls, and preserves execution options', async () => {
		const chunks: string[] = [];
		const controller = new AbortController();
		const on_data = (data: Buffer) => chunks.push(data.toString());

		const exec = vi.fn<BashOperations['exec']>(
			async (_command, _cwd, options) => {
				const bytes = Buffer.from(
					`é${token.slice(0, 10)}\x1b[31m${token.slice(10, 15)}\x00${token.slice(15, 20)}\uFFF9${token.slice(20)}\x1b[0m`,
				);

				options.onData(bytes.subarray(0, 1));
				options.onData(bytes.subarray(1, 18));
				options.onData(bytes.subarray(18));
				expect(chunks).toEqual([]);

				return { exitCode: 23 };
			},
		);

		const operations = redacting_bash_operations(
			{ exec },
			create_redactor().text,
		);

		expect(
			await operations.exec('unchanged command', '/working', {
				onData: on_data,
				signal: controller.signal,
				timeout: 4,
				env: { SYNTHETIC: 'value' },
			}),
		).toEqual({ exitCode: 23 });
		expect(exec.mock.calls[0]).toMatchObject([
			'unchanged command',
			'/working',
			{
				signal: controller.signal,
				timeout: 4,
				env: { SYNTHETIC: 'value' },
			},
		]);
		expect(chunks.join('')).toContain('é');
		expect(chunks.join('')).not.toContain(token);
		expect(chunks.join('')).toContain('[REDACTED:');
	});

	it('streams complete safe lines during execution and holds incomplete credential lines', async () => {
		const output: string[] = [];

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					options.onData(Buffer.from('progress one\n'));
					expect(output.join('')).toBe('progress one\n');
					options.onData(Buffer.from('password = "synthetic-'));
					expect(output.join('')).toBe('progress one\n');
					options.onData(Buffer.from('credential"\nprogress two\n'));
					expect(output.join('')).toContain('progress two\n');
					expect(output.join('')).not.toContain(
						'synthetic-credential',
					);

					return { exitCode: 0 };
				},
			},
			create_redactor().text,
		);

		await operations.exec('cmd', '/cwd', {
			onData: (data) => output.push(data.toString()),
		});
	});

	it.each([
		'\x1b[31m',
		'\x1b]8;;' + 'z'.repeat(600) + '\x07',
		'\u009b31m',
	])(
		'handles terminal sequences split at every byte without a size cap',
		async (escape) => {
			const output: string[] = [];

			const operations = redacting_bash_operations(
				{
					async exec(_command, _cwd, options) {
						const bytes = Buffer.from(
							token.slice(0, 12) + escape + token.slice(12) + '\n',
						);

						for (let index = 0; index < bytes.length; index++)
							options.onData(bytes.subarray(index, index + 1));

						expect(output.join('')).toContain('[REDACTED:');
						expect(output.join('')).not.toContain(token);

						return { exitCode: 0 };
					},
				},
				create_redactor().text,
			);

			await operations.exec('cmd', '/cwd', {
				onData: (data) => output.push(data.toString()),
			});
		},
	);

	it.each(['private α\nopaque β', 'private α\r\nopaque β'])(
		'holds registered multiline prefixes across bytes and normalization: %j',
		async (value) => {
			const redactor = create_redactor();
			redactor.register([value]);
			const output: string[] = [];

			const operations = redacting_bash_operations(
				{
					async exec(_command, _cwd, options) {
						options.onData(Buffer.from('progress\n'));
						expect(output.join('')).toBe('progress\n');
						const bytes = Buffer.from(value);

						for (let index = 0; index < bytes.length; index++) {
							options.onData(bytes.subarray(index, index + 1));
							expect(output.join('')).not.toContain('private');
						}

						options.onData(Buffer.from('\nfinished\n'));
						expect(output.join('')).toContain('finished\n');

						return { exitCode: 0 };
					},
				},
				redactor.text,
				() => redactor.known_values,
			);

			await operations.exec('cmd', '/cwd', {
				onData: (data) => output.push(data.toString()),
			});
			expect(output.join('')).toContain('[REDACTED:Known Secret]');
			expect(output.join('')).not.toContain('opaque');
		},
	);

	it('masks overlapping registered values without releasing a longer suffix', async () => {
		const redactor = create_redactor();
		redactor.register(['ab', 'abcd']);
		const output: string[] = [];

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					for (const chunk of ['ab', 'c', 'd', '\n'])
						options.onData(Buffer.from(chunk));

					return { exitCode: 0 };
				},
			},
			redactor.text,
			() => redactor.known_values,
		);

		await operations.exec('cmd', '/cwd', {
			onData: (data) => output.push(data.toString()),
		});
		expect(output.join('')).not.toContain('ab');
		expect(output.join('')).not.toContain('cd');
		expect(output.join('')).toContain('[REDACTED:Known Secret]');
	});

	it('preserves PEM proof and continuation across chunks without swallowing ordinary text', async () => {
		const output: string[] = [];
		const body = 'YWJj'.repeat(24);

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					options.onData(Buffer.from('progress\n'));
					options.onData(
						Buffer.from(`-----${'BEGIN PRIVATE KEY-----'}\n`),
					);
					expect(output.join('')).toBe('progress\n');
					options.onData(Buffer.from(body + '\n'));
					expect(output.join('')).toContain('[REDACTED:Private Key]');
					options.onData(Buffer.from(body.slice(0, 20)));
					options.onData(Buffer.from(body.slice(20) + '\nYWJj\n'));
					options.onData(
						Buffer.from(`-----${'END PRIVATE KEY-----'}\nfinished\n`),
					);
					expect(output.join('')).toContain('finished\n');

					return { exitCode: 0 };
				},
			},
			create_redactor().text,
		);

		await operations.exec('cmd', '/cwd', {
			onData: (data) => output.push(data.toString()),
		});
		expect(output.join('')).not.toContain('YWJj');
	});

	it.each([
		['Host synthetic-host\n', 'User synthetic-user\n'],
		['User synthetic-user\n', 'Host synthetic-host\n'],
	])(
		'retains SSH evidence in either order: %j then %j',
		async (first, second) => {
			const output: string[] = [];

			const operations = redacting_bash_operations(
				{
					async exec(_command, _cwd, options) {
						options.onData(Buffer.from('progress\n' + first));
						expect(output.join('')).toBe('progress\n');
						options.onData(Buffer.from('# separator\n' + second));
						expect(output.join('')).toContain('[REDACTED:SSH');
						options.onData(
							Buffer.from('IdentityFile /synthetic/key\nfinished\n'),
						);
						expect(output.join('')).toContain('finished\n');

						return { exitCode: 0 };
					},
				},
				create_redactor().text,
			);

			await operations.exec('cmd', '/cwd', {
				onData: (data) => output.push(data.toString()),
			});
			expect(output.join('')).not.toContain('synthetic-host');
			expect(output.join('')).not.toContain('synthetic-user');
			expect(output.join('')).not.toContain('/synthetic/key');
		},
	);

	it('preserves unconfirmed SSH/prose and standalone PEM examples at EOF', async () => {
		const output: string[] = [];
		const text = `User documentation is available\nordinary prose\n-----${'BEGIN PRIVATE KEY-----'}\nNotes\nmore ordinary prose\n`;

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					for (const character of text)
						options.onData(Buffer.from(character));

					return { exitCode: 0 };
				},
			},
			create_redactor().text,
		);

		await operations.exec('cmd', '/cwd', {
			onData: (data) => output.push(data.toString()),
		});
		expect(output.join('')).toBe(text);
	});

	it.each([
		{
			values: ['BEGIN PRIVATE KEY'],
			text: `-----${'BEGIN PRIVATE KEY-----'}\n${'YWJj'.repeat(24)}\n${'ZGVm'.repeat(24)}\n-----${'END PRIVATE KEY-----'}\n`,
			absent: ['YWJj', 'ZGVm'],
		},
		{
			values: ['YWJj'],
			text: `-----${'BEGIN PRIVATE KEY-----'}\n${'YWJj'.repeat(24)}\n${'ZGVm'.repeat(24)}\n-----${'END PRIVATE KEY-----'}\n`,
			absent: ['YWJj', 'ZGVm'],
		},
		{
			values: ['Host'],
			text: 'Host synthetic-host\nUser synthetic-user\n',
			absent: ['synthetic-host', 'synthetic-user'],
		},
		{
			values: ['password'],
			text: 'password = "synthetic-opaque-password"\n',
			absent: ['synthetic-opaque-password'],
		},
		{
			values: ['prefix\npassword'],
			text: 'prefix\npassword = "synthetic-opaque-password"\n',
			absent: ['synthetic-opaque-password'],
		},
	])(
		'retains raw detection context when exact matches mask structural labels: $values',
		async ({ values, text, absent }) => {
			const redactor = create_redactor();
			redactor.register(values);
			const output: string[] = [];

			const operations = redacting_bash_operations(
				{
					async exec(_command, _cwd, options) {
						for (const character of text)
							options.onData(Buffer.from(character));

						return { exitCode: 0 };
					},
				},
				redactor.text,
				() => redactor.known_values,
			);

			await operations.exec('cmd', '/cwd', {
				onData: (data) => output.push(data.toString()),
			});

			for (const value of absent)
				expect(output.join('')).not.toContain(value);

			expect(output.join('')).toContain('[REDACTED:');
		},
	);

	it.each([
		{
			values: ['Known'],
			input: '[REDACTED:Known Secret]\n',
			expected: '[REDACTED:Known Secret]\n',
		},
		{
			values: ['Known'],
			input: 'password = "[REDACTED:Known Secret]"\n',
			expected: 'password = "[REDACTED:Known Secret]"\n',
		},
		{
			values: ['abc', 'xabcd'],
			input: 'xabcY\n',
			expected: 'x[REDACTED:Known Secret]Y\n',
		},
		{
			values: [],
			input: `-----${'BEGIN PRIVATE KEY-----'}\nNotes\nDocumentationIdentifierIsLongEnough\n`,
			expected: `-----${'BEGIN PRIVATE KEY-----'}\nNotes\nDocumentationIdentifierIsLongEnough\n`,
		},
		{
			values: [token],
			input: `Fetched ${token} for the request\n`,
			expected: 'Fetched [REDACTED:Known Secret] for the request\n',
		},
	])(
		'preserves canonical placeholders and neighboring ordinary text: $input',
		async ({ values, input, expected }) => {
			const redactor = create_redactor();
			redactor.register(values);
			const output: string[] = [];

			const operations = redacting_bash_operations(
				{
					async exec(_command, _cwd, options) {
						for (const character of input)
							options.onData(Buffer.from(character));

						return { exitCode: 0 };
					},
				},
				redactor.text,
				() => redactor.known_values,
			);

			await operations.exec('cmd', '/cwd', {
				onData: (data) => output.push(data.toString()),
			});
			expect(output.join('')).toBe(expected);
		},
	);

	it('streams clearly invalid multiword User prose without waiting for SSH proof', async () => {
		const output: string[] = [];

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					for (const line of [
						'User documentation is available\n',
						'progress one\n',
						'progress two\n',
					]) {
						options.onData(Buffer.from(line));
						expect(output.join('')).toContain(line);
					}

					return { exitCode: 0 };
				},
			},
			create_redactor().text,
		);

		await operations.exec('cmd', '/cwd', {
			onData: (data) => output.push(data.toString()),
		});
	});

	it('coalesces multiline safe output into one callback per backend chunk', async () => {
		const chunks: string[] = [];
		const text = 'ordinary progress\n'.repeat(3000);

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					options.onData(Buffer.from(text));
					expect(chunks).toEqual([text]);

					return { exitCode: 0 };
				},
			},
			create_redactor().text,
		);

		await operations.exec('cmd', '/cwd', {
			onData: (data) => chunks.push(data.toString()),
		});
		expect(chunks).toEqual([text]);
	});

	it('scans an unfinished long line only once instead of rescanning cumulative chunks', async () => {
		let scanned = 0;
		const output: string[] = [];

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					for (let index = 0; index < 20000; index++)
						options.onData(Buffer.from('z'));
					expect(scanned).toBe(0);

					return { exitCode: 0 };
				},
			},
			(text) => {
				scanned += text.length;

				return text;
			},
		);

		await operations.exec('cmd', '/cwd', {
			onData: (data) => output.push(data.toString()),
		});
		expect(scanned).toBe(20000);
		expect(output.join('')).toBe('z'.repeat(20000));
	});

	it('masks an unfinished payload tail when cancellation interrupts an established key', async () => {
		const output: string[] = [];
		const controller = new AbortController();

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					options.onData(
						Buffer.from(
							`-----${'BEGIN PRIVATE KEY-----'}\n${'YWJj'.repeat(24)}\nYWJj`,
						),
					);
					controller.abort();
					throw new Error('cancelled');
				},
			},
			create_redactor().text,
		);

		await expect(
			operations.exec('cmd', '/cwd', {
				signal: controller.signal,
				onData: (data) => output.push(data.toString()),
			}),
		).rejects.toThrow('cancelled');
		expect(output.join('')).not.toContain('YWJj');
	});

	it('flushes only sanitized output on abort and preserves backend failures', async () => {
		const controller = new AbortController();
		const output: string[] = [];
		const error = new Error(`failed with ${token}`);

		const operations = redacting_bash_operations(
			{
				async exec(_command, _cwd, options) {
					options.onData(Buffer.from(token));
					controller.abort();
					throw error;
				},
			},
			create_redactor().text,
		);

		await expect(
			operations.exec('cmd', '/cwd', {
				signal: controller.signal,
				onData: (data) => output.push(data.toString()),
			}),
		).rejects.toBe(error);
		expect(controller.signal.aborted).toBe(true);
		expect(error.message).not.toContain(token);
		expect(output.join('')).not.toContain(token);
		expect(output.join('')).toContain('[REDACTED:');
	});
});

describe('structured output', () => {
	it('preserves values, schemas and opaque binary payloads without mutating the source', () => {
		const input = {
			count: 1,
			enabled: true,
			absent: null,
			schema: { type: 'string', enum: ['a', 'b'] },
			data: { text: token },
			binary: { mimeType: 'image/png', data: token },
			timestamp: new Date(0),
		};

		const result = redact_data(input, create_redactor().text);
		expect(result).toMatchObject({
			count: 1,
			enabled: true,
			absent: null,
			schema: input.schema,
			binary: input.binary,
			timestamp: input.timestamp,
		});
		expect(result.data.text).not.toContain(token);
		expect(input.data.text).toBe(token);
	});

	it('keeps clean text blocks intact and masks metadata beside opaque binary bytes', () => {
		const redact = create_redactor().text;

		const blocks = [
			{ type: 'text', text: 'first', attribution: 'a' },
			{ type: 'text', text: 'second', attribution: 'b' },
		];

		expect(redact_data(blocks, redact)).toEqual(blocks);

		const image = {
			type: 'image',
			data: token,
			mimeType: 'image/png',
			description: token,
			url: `https://example.test/?value=${token}`,
		};

		const result = redact_data(image, redact);
		expect(result.data).toBe(token);
		expect(result.description).not.toContain(token);
		expect(result.url).not.toContain(token);

		const metadata = redact_data(
			[{ type: 'text', text: 'ordinary', extra: token }],
			redact,
		);

		expect(metadata[0].text).toBe('ordinary');
		expect(metadata[0].extra).not.toContain(token);
	});

	it('does not throw on contextual JSON redaction and preserves cycles/shared references', () => {
		const redact = create_redactor().text;

		const source = {
			value: 'password is synthetic-opaque-credential',
		};

		expect(() => redact_data(source, redact)).not.toThrow();
		expect(redact_data(source, redact).value).not.toContain(
			'synthetic-opaque-credential',
		);
		const shared = { value: token };

		const cycle: CyclicFixture = { first: shared, second: shared };

		cycle.self = cycle;
		const result = redact_data(cycle, redact);
		expect(result.self).toBe(result);
		expect(result.first).toBe(result.second);
		expect(result.first.value).not.toContain(token);
	});

	it('bounds historical memoization and invalidates even previously clean entries on registration', () => {
		const redact = create_redactor();
		redact.text(token);
		const initial = redact.total;
		redact.text(token);
		expect(redact.total).toBe(initial);

		for (let index = 0; index < 600; index++)
			redact.text(`clean ordinary output ${index}`);

		redact.text(token);
		expect(redact.total).toBeGreaterThan(initial);
		const opaque = 'synthetic unshaped text';
		expect(redact.text(opaque)).toBe(opaque);
		redact.register([opaque]);
		expect(redact.text(opaque)).not.toContain(opaque);
	});
});
