import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

interface TrustedLspBinaryEntry {
	binary_path: string;
	trusted_at: string;
}

type TrustedLspBinaries = Record<string, TrustedLspBinaryEntry>;

export function default_lsp_trust_store_path(): string {
	return join(homedir(), '.pi', 'agent', 'trusted-lsp-binaries.json');
}

export function is_lsp_binary_trusted(
	binary_path: string,
	trust_store_path = default_lsp_trust_store_path(),
): boolean {
	const trusted_binaries = read_trusted_binaries(trust_store_path);
	return trusted_binaries[binary_path]?.binary_path === binary_path;
}

export function trust_lsp_binary(
	binary_path: string,
	trust_store_path = default_lsp_trust_store_path(),
): void {
	const trusted_binaries = read_trusted_binaries(trust_store_path);
	trusted_binaries[binary_path] = {
		binary_path,
		trusted_at: new Date().toISOString(),
	};
	mkdirSync(dirname(trust_store_path), { recursive: true });
	writeFileSync(
		trust_store_path,
		JSON.stringify(trusted_binaries, null, '\t') + '\n',
		{ encoding: 'utf8', mode: 0o600 },
	);
}

function read_trusted_binaries(
	trust_store_path: string,
): TrustedLspBinaries {
	if (!existsSync(trust_store_path)) return {};
	try {
		const raw = readFileSync(trust_store_path, 'utf-8');
		const parsed = JSON.parse(raw) as TrustedLspBinaries;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}
