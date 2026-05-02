import { describe, expect, it } from 'vitest';
import {
	looks_like_ssh_config,
	redact_ssh_config_metadata,
	redact_text,
} from './index.js';

describe('redact_text', () => {
	it('redacts AWS access keys', () => {
		const input = 'key: AKIA1234567890ABCDEF';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:AWS Access Key]');
		expect(redacted).not.toContain('AKIA1234567890ABCDEF');
	});

	it('redacts AWS temp access keys', () => {
		const input = 'key: ASIA1234567890ABCDEF';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:AWS Temp Access Key]');
		expect(redacted).not.toContain('ASIA1234567890ABCDEF');
	});

	it('redacts uppercase AWS secret env vars', () => {
		const input =
			'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY01';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:AWS Secret Key]');
		expect(redacted).not.toContain(
			'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY01',
		);
	});

	it('redacts bearer tokens', () => {
		const input =
			'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Bearer Token]');
		expect(redacted).not.toContain(
			'Bearer abcdefghijklmnopqrstuvwxyz123456',
		);
	});

	it('redacts full private key blocks', () => {
		const input = `-----BEGIN PRIVATE KEY-----\nQ0FOQVJZX1BSSVZBVEVfS0VZX0JMT0NLX0xJTkVfMDAx\nQ0FOQVJZX1BSSVZBVEVfS0VZX0JMT0NLX0xJTkVfMDAy\n-----END PRIVATE KEY-----`;
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Private Key]');
		expect(redacted).not.toContain(
			'Q0FOQVJZX1BSSVZBVEVfS0VZX0JMT0NLX0xJTkVfMDAx',
		);
	});

	it('redacts connection strings with passwords', () => {
		const input =
			'postgres://user:super-secret-password@localhost:5432/app';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain(
			'[REDACTED:Connection String with Password]',
		);
		expect(redacted).not.toContain(':super-secret-password@');
	});

	it('redacts generic secret fields', () => {
		const input = 'SERVICE_PASSWORD=CanaryPassword-Redaction-001!';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Generic Password Field]');
		expect(redacted).not.toContain('CanaryPassword-Redaction-001!');
	});

	it('redacts GitHub fine-grained PATs', () => {
		const input = 'github_pat_' + 'A'.repeat(30);
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:GitHub Fine-grained PAT]');
		expect(redacted).not.toContain('github_pat_' + 'A'.repeat(30));
	});

	it('redacts SSH config metadata from a config block', () => {
		const input = `Host prod-app\n  HostName 10.0.0.12\n  User deploy\n  IdentityFile ~/.ssh/work-prod\n  ProxyJump bastion.internal\n  LocalForward 5432 db.internal:5432\n  RemoteForward 8443 localhost:443\n  DynamicForward 1080\n  ProxyCommand ssh -W %h:%p bastion.internal\n  CertificateFile ~/.ssh/work-prod-cert.pub\n  HostKeyAlias prod-app.internal\n  Match host *.internal user deploy\n`;
		const { redacted, count } = redact_text(input);
		expect(count).toBe(12);
		expect(redacted).toContain('Host [REDACTED:SSH Host]');
		expect(redacted).toContain('HostName [REDACTED:SSH HostName]');
		expect(redacted).toContain('User [REDACTED:SSH User]');
		expect(redacted).toContain(
			'IdentityFile [REDACTED:SSH IdentityFile]',
		);
		expect(redacted).toContain('ProxyJump [REDACTED:SSH ProxyJump]');
		expect(redacted).toContain(
			'LocalForward [REDACTED:SSH LocalForward]',
		);
		expect(redacted).toContain(
			'RemoteForward [REDACTED:SSH RemoteForward]',
		);
		expect(redacted).toContain(
			'DynamicForward [REDACTED:SSH DynamicForward]',
		);
		expect(redacted).toContain(
			'ProxyCommand [REDACTED:SSH ProxyCommand]',
		);
		expect(redacted).toContain(
			'CertificateFile [REDACTED:SSH CertificateFile]',
		);
		expect(redacted).toContain(
			'HostKeyAlias [REDACTED:SSH HostKeyAlias]',
		);
		expect(redacted).toContain('Match [REDACTED:SSH Match]');
		expect(redacted).not.toContain('10.0.0.12');
		expect(redacted).not.toContain('deploy');
		expect(redacted).not.toContain('~/.ssh/work-prod');
		expect(redacted).not.toContain('bastion.internal');
	});

	it('keeps Host * and Match all unchanged', () => {
		const input = `Host *\n  ServerAliveInterval 30\nMatch all\n  ForwardAgent no\n`;
		const { redacted, count } = redact_text(input, {
			force_ssh_config: true,
		});
		expect(count).toBe(0);
		expect(redacted).toBe(input);
	});

	it('does not treat ordinary prose as SSH config', () => {
		const input =
			'User deploy should run HostName setup in docs first.';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(0);
		expect(redacted).toBe(input);
	});

	it('can force SSH redaction for config fragments', () => {
		const input = 'HostName 10.42.0.7';
		const { redacted, count } = redact_text(input, {
			force_ssh_config: true,
		});
		expect(count).toBe(1);
		expect(redacted).toBe('HostName [REDACTED:SSH HostName]');
	});

	it('leaves clean text unchanged', () => {
		const input = 'This is normal output with no secrets.';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(0);
		expect(redacted).toBe(input);
	});

	it('does not redact ordinary package metadata and documentation links', () => {
		const input = JSON.stringify(
			{
				name: 'my-pi',
				homepage: 'https://github.com/spences10/my-pi',
				repository: {
					type: 'git',
					url: 'git+https://github.com/spences10/my-pi.git',
				},
				author: 'Scott Spence <scott@example.com>',
				keywords: ['cli', 'sqlite', 'telemetry'],
				badge: 'https://img.shields.io/npm/v/@spences10/pi-redact',
			},
			null,
			2,
		);
		const markdown = `${input}\n[repo](https://github.com/spences10/my-pi)\n[npm](https://www.npmjs.com/package/@spences10/pi-redact)`;
		const { redacted, count } = redact_text(markdown);
		expect(count).toBe(0);
		expect(redacted).toBe(markdown);
	});

	it('does not let generic secret phrases span prose or markdown boundaries', () => {
		const input = `The redactor detects secrets defensively.

- tokens, passwords, and API keys are examples.
- Prefer nopeek for secret-safe loading.

See https://github.com/spences10/nopeek for details.`;
		const { redacted, count } = redact_text(input);
		expect(count).toBe(0);
		expect(redacted).toBe(input);
	});

	it('still redacts generic secret phrases with explicit values', () => {
		const input = 'password is CanaryPassword-Redaction-001!';
		const { redacted, count } = redact_text(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Generic Secret Phrase]');
		expect(redacted).not.toContain('CanaryPassword-Redaction-001!');
	});
});

describe('SSH helpers', () => {
	it('detects SSH config content', () => {
		const input = `Host prod\n  HostName 10.0.0.12\n  User deploy\n`;
		expect(looks_like_ssh_config(input)).toBe(true);
	});

	it('does not detect unrelated content as SSH config', () => {
		expect(
			looks_like_ssh_config('HostName examples are documented here.'),
		).toBe(false);
	});

	it('redacts SSH config metadata directly', () => {
		const input = `Host prod\n  HostName 192.168.1.20\n  User ubuntu\n`;
		const { redacted, count } = redact_ssh_config_metadata(input);
		expect(count).toBe(3);
		expect(redacted).toContain('Host [REDACTED:SSH Host]');
		expect(redacted).toContain('HostName [REDACTED:SSH HostName]');
		expect(redacted).toContain('User [REDACTED:SSH User]');
	});
});
