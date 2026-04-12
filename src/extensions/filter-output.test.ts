import { describe, expect, it } from 'vitest';

// Extract redact function for direct testing
// (mirrors the logic in filter-output.ts)
interface SecretPattern {
	name: string;
	pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
	{ name: 'AWS Access Key', pattern: /AKIA[A-Z0-9]{16}/g },
	{
		name: 'AWS Secret Key',
		pattern:
			/(?:SecretAccessKey|aws_secret_access_key)\s*[:=]\s*[A-Za-z0-9/+=]{40}/g,
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
		pattern: /-----BEGIN\s+[\w\s]*PRIVATE\s+KEY-----/g,
	},
	{
		name: 'Connection String with Password',
		pattern: /:\/\/[^:]+:[^@]+@/g,
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
		const input = 'key: AKIAIOSFODNN7EXAMPLE';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:AWS Access Key]');
		expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
	});

	it('redacts bearer tokens', () => {
		const input =
			'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Bearer Token]');
	});

	it('redacts OpenAI/Anthropic API keys', () => {
		const input =
			'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:OpenAI/Anthropic API Key]');
	});

	it('redacts Stripe live keys', () => {
		const input = `sk_live_${'51HgT2CJa8qB1E7R9X4abcdefghijklmn'}`;
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Stripe Live Key]');
	});

	it('redacts private key headers', () => {
		const input = '-----BEGIN RSA PRIVATE KEY-----';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Private Key]');
	});

	it('redacts connection strings with passwords', () => {
		const input = 'postgres://user:s3cretP@ss@localhost:5432/db';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain(
			'[REDACTED:Connection String with Password]',
		);
	});

	it('redacts Tavily API keys', () => {
		const input =
			'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';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Tavily API Key]');
	});

	it('redacts Firecrawl API keys', () => {
		const input = 'fc-e3011a33574e44c8aa539c24218cd659';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:Firecrawl API Key]');
	});

	it('redacts GitHub tokens', () => {
		const input = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn';
		const { redacted, count } = redact(input);
		expect(count).toBe(1);
		expect(redacted).toContain('[REDACTED:GitHub Token]');
	});

	it('redacts multiple secrets in one string', () => {
		const input =
			'aws: AKIAIOSFODNN7EXAMPLE, token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.longtoken';
		const { redacted, count } = redact(input);
		expect(count).toBe(2);
		expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
	});

	it('leaves clean text unchanged', () => {
		const input = 'This is normal output with no secrets.';
		const { redacted, count } = redact(input);
		expect(count).toBe(0);
		expect(redacted).toBe(input);
	});

	it('preserves prefix in redacted output', () => {
		const input = 'AKIAIOSFODNN7EXAMPLE';
		const { redacted } = redact(input);
		expect(redacted).toMatch(/^AKIA/);
	});
});
