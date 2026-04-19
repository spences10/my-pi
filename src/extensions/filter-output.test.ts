import { describe, expect, it } from 'vitest';

interface SecretPattern {
	name: string;
	pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
	{ name: 'AWS Access Key', pattern: /AKIA[A-Z0-9]{16}/g },
	{
		name: 'AWS Secret Key',
		pattern:
			/\b(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key|secret_access_key|SecretAccessKey)\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{40,}["']?/g,
	},
	{
		name: 'Bearer Token',
		pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
	},
	{
		name: 'OpenAI/Anthropic API Key',
		pattern: /sk-[a-zA-Z0-9._-]{20,}/g,
	},
	{
		name: 'Stripe Live Key',
		pattern: /sk_live_[a-zA-Z0-9]{20,}/g,
	},
	{
		name: 'Stripe Test Key',
		pattern: /sk_test_[a-zA-Z0-9]{20,}/g,
	},
	{
		name: 'Private Key',
		pattern:
			/-----BEGIN\s+[\w\s]*PRIVATE\s+KEY-----[\s\S]*?-----END\s+[\w\s]*PRIVATE\s+KEY-----/g,
	},
	{
		name: 'Connection String with Password',
		pattern: /:\/\/[^:]+:[^@]+@/g,
	},
	{
		name: 'Generic Password Field',
		pattern:
			/\b[\w-]*(?:password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._:/+=@!-]{8,}/gi,
	},
	{
		name: 'Generic Secret Phrase',
		pattern:
			/\b(?:password|passwd|secret|token|api[_-]?key)\b(?:\s+(?:is|was|seen|value|header))?\s*[:=]?\s+[A-Za-z0-9._:/+=@!-]{8,}/gi,
	},
	{
		name: 'Tavily API Key',
		pattern: /tvly-[a-zA-Z0-9_-]{20,}/g,
	},
	{
		name: 'Firecrawl API Key',
		pattern: /fc-[a-f0-9]{32}/g,
	},
	{
		name: 'GitHub Token',
		pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
	},
];

function redact(text: string): { redacted: string; count: number } {
	let count = 0;
	let result = text;

	for (const sp of SECRET_PATTERNS) {
		sp.pattern.lastIndex = 0;
		result = result.replace(sp.pattern, (match) => {
			count++;
			const prefix = match.slice(0, 4);
			return `${prefix}${'*'.repeat(Math.min(match.length - 4, 20))}[REDACTED:${sp.name}]`;
		});
	}

	return { redacted: result, count };
}

describe('redact', () => {
	it('redacts AWS access keys', () => {
		const input = 'key: AKIA1234567890CANARY';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:AWS Access Key]');
		expect(redacted).not.toContain('AKIA1234567890CANARY');
	});

	it('redacts uppercase AWS secret env vars', () => {
		const input =
			'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG+bPxRfiCYCANARYKEY01';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:AWS Secret Key]');
		expect(redacted).not.toContain(
			'wJalrXUtnFEMI/K7MDENG+bPxRfiCYCANARYKEY01',
		);
	});

	it('redacts lower-case secret_access_key assignments', () => {
		const input =
			'secret_access_key = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYCANARYKEY01"';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:AWS Secret Key]');
		expect(redacted).not.toContain(
			'wJalrXUtnFEMI/K7MDENG+bPxRfiCYCANARYKEY01',
		);
	});

	it('redacts bearer tokens', () => {
		const input =
			'Authorization: Bearer canaryBearerTokenValueAlphaNum1234567890ZZ';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Bearer Token]');
	});

	it('redacts OpenAI/Anthropic API keys', () => {
		const input =
			'ANTHROPIC_API_KEY=sk-ant-api-key-example-123456789012345';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:OpenAI/Anthropic API Key]');
		expect(redacted).not.toContain(
			'[REDACTED:Generic Password Field]',
		);
	});

	it('redacts Stripe live keys', () => {
		const input = `sk_live_${'51HgT2CJa8qB1E7R9X4abcdefghijklmn'}`;
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Stripe Live Key]');
	});

	it('redacts full private key blocks', () => {
		const input = `-----BEGIN PRIVATE KEY-----\nQ0FOQVJZX1BSSVZBVEVfS0VZX0JMT0NLX0xJTkVfMDAx\nQ0FOQVJZX1BSSVZBVEVfS0VZX0JMT0NLX0xJTkVfMDAy\n-----END PRIVATE KEY-----`;
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Private Key]');
		expect(redacted).not.toContain(
			'Q0FOQVJZX1BSSVZBVEVfS0VZX0JMT0NLX0xJTkVfMDAx',
		);
	});

	it('redacts connection strings with passwords', () => {
		const input = 'postgres://user:supersecretpass@localhost:5432/db';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain(
			'[REDACTED:Connection String with Password]',
		);
	});

	it('redacts prefixed generic secret fields', () => {
		const input =
			'OPAQUE_SECRET=cnyr_ZmFrZVNlY3JldFZhbHVlX1JlZGFjdGlvbl9TdWl0ZV8wMDE';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Generic Password Field]');
		expect(redacted).not.toContain(
			'cnyr_ZmFrZVNlY3JldFZhbHVlX1JlZGFjdGlvbl9TdWl0ZV8wMDE',
		);
	});

	it('redacts freeform secret phrases in logs', () => {
		const input =
			'2026-04-19T09:00:02Z INFO opaque fallback secret cnyr_ZmFrZVNlY3JldFZhbHVlX1JlZGFjdGlvbl9TdWl0ZV8wMDE';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Generic Secret Phrase]');
		expect(redacted).not.toContain(
			'cnyr_ZmFrZVNlY3JldFZhbHVlX1JlZGFjdGlvbl9TdWl0ZV8wMDE',
		);
	});

	it('redacts Tavily API keys', () => {
		const input = 'tvly-canary-redaction-suite-000000000000000001';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Tavily API Key]');
	});

	it('redacts Firecrawl API keys', () => {
		const input = 'fc-e3b0c44298fc1c149afbf4c8996fb924';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Firecrawl API Key]');
	});

	it('redacts GitHub tokens', () => {
		const input =
			'ghp_CanaryRedactionSuite000000000000000000000001ABCD';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:GitHub Token]');
	});

	it('redacts multiple secrets in one string', () => {
		const input =
			'aws: AKIA1234567890CANARY, SERVICE_PASSWORD=CanaryPassword-Redaction-001!';
		const { redacted, count } = redact(input);
		expect(count).toBe(2);
		expect(redacted).not.toContain('AKIA1234567890CANARY');
		expect(redacted).not.toContain('CanaryPassword-Redaction-001!');
	});

	it('leaves clean text unchanged', () => {
		const input = 'This is normal output with no secrets.';
		const { redacted, count } = redact(input);
		expect(count).toBe(0);
		expect(redacted).toBe(input);
	});

	it('preserves prefix in redacted output', () => {
		const input = 'AKIA1234567890CANARY';
		const { redacted } = redact(input);
		expect(redacted).toMatch(/^AKIA/);
	});
});
