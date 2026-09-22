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

const SECRETS_FILE = 'my-pi-secrets.json';

type SecretsFile = {
	version: 1;
	packages: Record<
		string,
		{ deepgramApiKey?: string; enabled?: boolean } | undefined
	>;
};

function empty_secrets(): SecretsFile {
	return { version: 1, packages: {} };
}

export function read_talk_secrets(
	path = join(getAgentDir(), SECRETS_FILE),
) {
	try {
		const parsed = JSON.parse(
			readFileSync(path, 'utf8'),
		) as SecretsFile;
		const talk = parsed.packages?.['pi-talk'];
		return {
			enabled: talk?.enabled === true,
			apiKey:
				typeof talk?.deepgramApiKey === 'string'
					? talk.deepgramApiKey
					: undefined,
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
		secrets = JSON.parse(readFileSync(path, 'utf8')) as SecretsFile;
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
	secrets.packages ??= {};
	secrets.packages['pi-talk'] = {
		enabled: value.enabled,
		...(value.apiKey ? { deepgramApiKey: value.apiKey } : {}),
	};
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
		secrets = JSON.parse(readFileSync(path, 'utf8')) as SecretsFile;
	} catch {
		return;
	}
	delete secrets.packages?.['pi-talk'];
	if (Object.keys(secrets.packages ?? {}).length === 0) {
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
