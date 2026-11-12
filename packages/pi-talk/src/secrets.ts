import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import * as v from 'valibot';

const SECRETS_FILE = 'my-pi-secrets.json';

const secrets_file_schema = v.looseObject({
	packages: v.nullish(v.looseObject({}), () => ({})),
});

const talk_secrets_schema = v.object({
	enabled: v.fallback(v.boolean(), false),
	deepgramApiKey: v.fallback(v.optional(v.string()), undefined),
});

type SecretsFile = v.InferOutput<typeof secrets_file_schema>;

function empty_secrets(): SecretsFile {
	return { version: 1, packages: {} };
}

export function read_talk_secrets(
	path = join(getAgentDir(), SECRETS_FILE),
) {
	try {
		const parsed = v.parse(
			secrets_file_schema,
			JSON.parse(readFileSync(path, 'utf8')),
		);

		const talk = v.parse(
			talk_secrets_schema,
			parsed.packages['pi-talk'],
		);

		return {
			enabled: talk.enabled,
			apiKey: talk.deepgramApiKey,
		};
	} catch {
		return { enabled: false, apiKey: undefined };
	}
}

export function write_talk_secrets(
	value: { enabled: boolean; apiKey?: string },
	path = join(getAgentDir(), SECRETS_FILE),
): void {
	let secrets = empty_secrets();

	try {
		secrets = v.parse(
			secrets_file_schema,
			JSON.parse(readFileSync(path, 'utf8')),
		);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('code' in error) ||
			error.code !== 'ENOENT'
		) {
			throw error;
		}
	}

	secrets.version = 1;
	secrets.packages['pi-talk'] = value.apiKey
		? { enabled: value.enabled, deepgramApiKey: value.apiKey }
		: { enabled: value.enabled };
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(secrets, null, 2)}\n`, {
		mode: 0o600,
	});
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
	chmodSync(path, 0o600);
}

export function forget_talk_secrets(
	path = join(getAgentDir(), SECRETS_FILE),
): void {
	let secrets: SecretsFile;

	try {
		secrets = v.parse(
			secrets_file_schema,
			JSON.parse(readFileSync(path, 'utf8')),
		);
	} catch {
		return;
	}

	delete secrets.packages['pi-talk'];

	if (Object.keys(secrets.packages).length === 0) {
		rmSync(path, { force: true });

		return;
	}

	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(secrets, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporary, path);
	chmodSync(path, 0o600);
}
