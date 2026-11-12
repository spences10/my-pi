/// <reference types="node" />

// Synthetic LSP server for diagnostics tests. Each line of the document
// text is a directive that tells the server what to publish:
//   publish-clean             publish an empty list for the current version
//   publish-error             publish one error for the current version
//   publish-stale-clean       publish an empty list for the previous version
//   publish-delayed:<ms>      publish an empty list after <ms>
//   publish-clean-on-close    publish an empty list when the document closes
// With no directive the server stays silent. `--pull` advertises pull
// diagnostics and answers a request with the same directives.
import { Buffer } from 'node:buffer';
import process from 'node:process';

const pull = process.argv.includes('--pull');

const expected_initialization_options = process.argv
	.find((arg) => arg.startsWith('--expect-initialization-options='))
	?.slice('--expect-initialization-options='.length);

const docs = new Map<string, string>();
let buffer = Buffer.alloc(0);

function send(message: object): void {
	const body = Buffer.from(JSON.stringify(message), 'utf8');
	process.stdout.write(
		Buffer.concat([
			Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
			body,
		]),
	);
}

const error_diagnostic = {
	range: {
		start: { line: 0, character: 0 },
		end: { line: 0, character: 1 },
	},
	severity: 1,
	source: 'synthetic',
	message: 'Boom',
};

function publish(
	uri: string,
	version: number | undefined,
	diagnostics: object[],
): void {
	send({
		jsonrpc: '2.0',
		method: 'textDocument/publishDiagnostics',
		params: { uri, version, diagnostics },
	});
}

function run_directives(
	uri: string,
	version: number,
	text: string,
): void {
	if (pull) return;

	for (const line of text.split('\n')) {
		const [directive, argument] = line.trim().split(':');

		if (directive === 'publish-clean') publish(uri, version, []);

		if (directive === 'publish-error') {
			publish(uri, version, [error_diagnostic]);
		}

		if (directive === 'publish-stale-clean') {
			publish(uri, version - 1, []);
		}

		if (directive === 'publish-delayed') {
			setTimeout(() => publish(uri, version, []), Number(argument));
		}

		if (directive === 'publish-delayed-error') {
			setTimeout(
				() => publish(uri, version, [error_diagnostic]),
				Number(argument),
			);
		}
	}
}

type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

interface ClientMessage {
	id?: number;
	method?: string;
	params: {
		initializationOptions?: JsonValue;
		textDocument: { uri: string; version: number; text: string };
		contentChanges: Array<{ text: string }>;
	};
}

function handle(message: ClientMessage): void {
	const { id, method, params } = message;

	if (method === 'initialize') {
		if (
			expected_initialization_options !== undefined &&
			(JSON.stringify(params.initializationOptions) ??
				'undefined') !== expected_initialization_options
		) {
			send({
				jsonrpc: '2.0',
				id,
				error: {
					code: -32602,
					message: 'Unexpected initialization options',
				},
			});

			return;
		}

		send({
			jsonrpc: '2.0',
			id,
			result: {
				capabilities: pull ? { diagnosticProvider: {} } : {},
			},
		});
	} else if (method === 'textDocument/didOpen') {
		const { uri, version, text } = params.textDocument;
		docs.set(uri, text);
		run_directives(uri, version, text);
	} else if (method === 'textDocument/didChange') {
		const { uri, version } = params.textDocument;
		const text = params.contentChanges[0].text;
		docs.set(uri, text);
		run_directives(uri, version, text);
	} else if (method === 'textDocument/didClose') {
		const { uri } = params.textDocument;

		if (docs.get(uri)?.includes('publish-clean-on-close')) {
			publish(uri, undefined, []);
		}

		const delay = docs
			.get(uri)
			?.match(/publish-delayed-clean-on-close:(\d+)/);

		if (delay)
			setTimeout(() => publish(uri, undefined, []), Number(delay[1]));
		docs.delete(uri);
	} else if (method === 'textDocument/diagnostic') {
		const text = docs.get(params.textDocument.uri) ?? '';

		const reply = () => {
			if (text.includes('publish-error')) {
				send({
					jsonrpc: '2.0',
					id,
					result: { kind: 'full', items: [error_diagnostic] },
				});
			} else if (text.includes('publish-clean')) {
				send({
					jsonrpc: '2.0',
					id,
					result: { kind: 'full', items: [] },
				});
			} else if (text.includes('no-items')) {
				send({ jsonrpc: '2.0', id, result: null });
			}
		};

		const delay = text.match(/pull-delayed:(\d+)/);

		if (delay) setTimeout(reply, Number(delay[1]));
		else reply();
	} else if (method === 'textDocument/hover') {
		send({
			jsonrpc: '2.0',
			id,
			result: {
				contents: params.textDocument.uri.endsWith('/malformed.ts')
					? 42
					: 'hover docs',
			},
		});
	} else if (method === 'shutdown') {
		send({ jsonrpc: '2.0', id, result: null });
	} else if (method === 'exit') {
		process.exit(0);
	}
}

process.stdin.on('data', (chunk: Buffer) => {
	buffer = Buffer.concat([buffer, chunk]);

	while (true) {
		const header_end = buffer.indexOf('\r\n\r\n');

		if (header_end === -1) return;

		const match = buffer
			.subarray(0, header_end)
			.toString('ascii')
			.match(/Content-Length:\s*(\d+)/i);

		const length = Number(match?.[1]);
		const body_start = header_end + 4;

		if (buffer.length < body_start + length) return;
		const body = buffer.subarray(body_start, body_start + length);
		buffer = buffer.subarray(body_start + length);
		handle(JSON.parse(body.toString('utf8')));
	}
});
