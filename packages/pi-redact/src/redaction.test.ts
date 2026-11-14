import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vite-plus/test';
import {
	classify_private_key_line,
	find_redaction_spans,
	is_redaction_marker,
	known_value_forms,
	looks_like_ssh_config,
	merge_redaction_spans,
	redact_ssh_config_metadata,
	redact_text,
} from './redaction.js';

const pem_header = ['-----', 'BEGIN PRIVATE KEY', '-----'].join('');
const pem_footer = ['-----', 'END PRIVATE KEY', '-----'].join('');

const pem_content = Buffer.from(
	'synthetic key material, never an issued key',
).toString('base64');

function expect_stable(
	input: string,
	known_values: readonly string[] = [],
): string {
	const first = redact_text(input, { known_values });
	expect(redact_text(first.redacted, { known_values })).toEqual({
		redacted: first.redacted,
		count: 0,
	});

	return first.redacted;
}

describe('literal fields', () => {
	it.each([
		'const token = lexemes[index];',
		'let password = configuration.getPassword();',
		'const secret = settings.authentication.password;',
		'const token = process.env.API_TOKEN;',
		'function parse(token: TokenOptions): void {}',
		'interface Options { password: CredentialOptions; }',
		'interface Options {\n  password: CredentialOptions;\n}',
		'  token: Record<string, string>;',
		'token: readonly string[];',
		'token = lexemes[index]',
		'password = configuration.getPassword()',
		'password = settings.authentication.password',
		'APP_PASSWORD=${PASSWORD_FROM_VAULT}',
		'token: ${{ inputs.token }}',
		'API_KEY=$(lookup-credential)',
		'password = `use-${settings.name}`',
		'const service_password = "configuration-placeholder-value";',
		'let cursor_secret = "another-placeholder-value";',
		'{"password": {"type": "string"}}',
		'The "password": "example-password" field is documented here.',
		'const token = "";\nconst message = "ordinary explanatory text";',
		'password = "\nordinary text on another line\n"',
		"token = '\nordinary text on another line\n'",
		'password = "\\\nordinary text on another line\n"',
		'# [pi-redact](../packages/pi-redact)',
		`docs/task-mask-${'q'.repeat(30)}/README.md`,
		`docs/prefixghp_${'m'.repeat(36)}.md`,
	])('preserves code or documentation: %s', (input) => {
		expect(redact_text(input)).toEqual({ redacted: input, count: 0 });
	});

	it.each([
		'8leading-digit![]$value',
		'[leading-bracket]value!$',
		'[bracketed!$value]',
		'$dollar-middle![]value',
		'synthetic!a$Z[3]\\q|+*?',
		'p@$$w0rd!xyz#%&*?~^',
		'letters-only-password',
		'abc,def;ghi}jkl]mnop',
	])('masks the entire punctuation value %s', (value) => {
		const result = redact_text(`PASSWORD=${value}`);
		expect(result).toEqual({
			redacted: 'PASSWORD=[REDACTED:Generic Password Field]',
			count: 1,
		});
		expect_stable(result.redacted);
	});

	it('preserves field names, quotes, comments and unrelated fields', () => {
		const value = ['synthetic', 'field-value!'].join('-');
		const input = `auth_token = "${value}"\ncursor_secret = '${value}' # comment\nexport SERVICE_PASSWORD=${value}\nport=9090\n{"client_secret": "${value}", "refresh_token": "${value}", "name": "normal"}`;
		const result = redact_text(input);
		expect(result.count).toBe(5);
		expect(result.redacted).not.toContain(value);
		expect(result.redacted).toContain(
			"cursor_secret = '[REDACTED:Generic Password Field]' # comment",
		);
		expect(result.redacted).toContain('port=9090');
		expect(result.redacted).toContain('"name": "normal"');
		expect_stable(result.redacted);
	});

	it('handles escaped quotes without spanning physical lines', () => {
		const value = ['synthetic', '"quoted"', '\\folder'].join('');

		const input = JSON.stringify({
			password: value,
			name: 'keep me',
		});

		const result = redact_text(input);
		expect(result.count).toBe(1);
		expect(JSON.parse(result.redacted)).toEqual({
			password: '[REDACTED:Generic Password Field]',
			name: 'keep me',
		});
	});

	it('retains the AWS secret field label', () => {
		const input = `AWS_SECRET_ACCESS_KEY=${'a1B2'.repeat(10)}`;
		expect(redact_text(input)).toEqual({
			redacted: 'AWS_SECRET_ACCESS_KEY=[REDACTED:AWS Secret Key]',
			count: 1,
		});
	});
});

describe('inline diagnostic fields', () => {
	const value = 'synthetic-boundary-value-1234567890';

	it.each([
		`small SERVICE_PASSWORD=${value}`,
		`Worker diagnostic: SERVICE_PASSWORD=${value}`,
		`Error: Worker exited (7): password=${value}`,
		`Error: Worker exited (7): password="${value}"`,
		`notice service_password='${value}' status=failed`,
		`notice ordinary=anything password=${value} status=failed`,
	])(
		'masks a literal value without removing its diagnostic prefix: %s',
		(input) => {
			const result = redact_text(input);
			expect(result).toEqual({
				redacted: input.replace(
					value,
					'[REDACTED:Generic Password Field]',
				),
				count: 1,
			});
			expect_stable(input);
		},
	);

	it('retains punctuation and JSON boundaries in embedded diagnostics', () => {
		const punctuation = 'P8!a$Z[3]\\q|+*?';

		const input = JSON.stringify({
			error: `Error: Worker exited (7): password=${punctuation}`,
		});

		expect(JSON.parse(redact_text(input).redacted)).toEqual({
			error:
				'Error: Worker exited (7): password=[REDACTED:Generic Password Field]',
		});
	});

	it.each([
		'const SERVICE_PASSWORD = "configuration-placeholder-value";',
		'export const service_password = "configuration-placeholder-value";',
		'doWork( password = fallbackValue )',
		'helpers.run( password = fallbackValue )',
		'diagnostic token = lexemes[index]',
		'diagnostic password = settings.password',
		'diagnostic token = readCredential()',
		'diagnostic token = `${settings.token}`',
		'Error: Worker exited (7): password=${FROM_VAULT}',
		'interface Options { password: CredentialOptions; }',
	])(
		'does not broaden diagnostics into code/types/templates: %s',
		(input) => {
			expect(redact_text(input)).toEqual({
				redacted: input,
				count: 0,
			});
		},
	);
});

describe('known_value_forms', () => {
	it('returns the supported representations once, longest first', () => {
		const value = 'registered "\\\\/☃ fixture';
		const encoded = encodeURIComponent(value);

		const expected = new Set([
			value,
			JSON.stringify(value).slice(1, -1),
			encoded,
			encoded.replace(/%[A-F0-9]{2}/g, (part) => part.toLowerCase()),
			Buffer.from(value).toString('base64'),
			Buffer.from(value).toString('base64url'),
		]);

		const forms = known_value_forms(['', value, value]);
		expect(new Set(forms)).toEqual(expected);
		expect(forms).toHaveLength(expected.size);
		expect(forms.map((form) => form.length)).toEqual(
			forms
				.map((form) => form.length)
				.sort((left, right) => right - left),
		);

		for (const form of forms) {
			expect(redact_text(form, { known_values: [value] })).toEqual({
				redacted: '[REDACTED:Known Secret]',
				count: 1,
			});
		}
	});

	it('ignores empty registrations without mutating the input', () => {
		const values = ['', 'fixture', 'fixture'] as const;
		expect(known_value_forms([])).toEqual([]);
		expect(known_value_forms([''])).toEqual([]);
		expect(known_value_forms(values)).toEqual(
			known_value_forms(['fixture']),
		);
		expect(values).toEqual(['', 'fixture', 'fixture']);
	});

	it('retains raw and JSON forms for lone surrogates', () => {
		const value = 'fixture\ud800text';
		expect(known_value_forms([value])).toContain(value);
		expect(known_value_forms([value])).toContain(
			JSON.stringify(value).slice(1, -1),
		);
	});
});

describe('explicit exact values', () => {
	const value = ['registered', '"\\/?', 'snowman-☃'].join('');

	it.each([
		['raw', value],
		['JSON', JSON.stringify(value).slice(1, -1)],
		['URI', encodeURIComponent(value)],
		[
			'URI lowercase escapes',
			encodeURIComponent(value).replace(/%[A-F0-9]{2}/g, (part) =>
				part.toLowerCase(),
			),
		],
		['base64', Buffer.from(value).toString('base64')],
		['base64url', Buffer.from(value).toString('base64url')],
	])('matches only registered %s representations', (_name, form) => {
		const input = `before ${form} after`;
		expect(redact_text(input)).toEqual({ redacted: input, count: 0 });
		expect(redact_text(input, { known_values: [value] })).toEqual({
			redacted: 'before [REDACTED:Known Secret] after',
			count: 1,
		});
		expect_stable(input, [value]);
	});

	it('does not infer secrets from arbitrary encoded output', () => {
		const source = Buffer.from(
			'perfectly ordinary release notes and source data',
		).toString('base64');

		expect(redact_text(source, { known_values: [value] })).toEqual({
			redacted: source,
			count: 0,
		});
	});

	it('handles short, repeated, overlapping and empty registrations', () => {
		const result = redact_text('a!bc a!bc a!', {
			known_values: ['', 'a!', 'a!bc', 'a!bc'],
		});

		expect(result).toEqual({
			redacted:
				'[REDACTED:Known Secret] [REDACTED:Known Secret] [REDACTED:Known Secret]',
			count: 3,
		});
		expect(redact_text('unchanged', { known_values: [''] })).toEqual({
			redacted: 'unchanged',
			count: 0,
		});
	});

	it('never matches registration substrings inside existing markers', () => {
		const input = '[REDACTED:Private Key] [REDACTED:Known Secret]';
		expect(
			redact_text(input, {
				known_values: ['Private', 'REDACTED', 'Known', 'Secret'],
			}),
		).toEqual({ redacted: input, count: 0 });
	});

	it('matches literal regular expression punctuation and line breaks', () => {
		const registered = 'a.*+?^${}()|[]\\\nnext';
		expect(
			redact_text(`prefix ${registered} suffix`, {
				known_values: [registered],
			}),
		).toEqual({
			redacted: 'prefix [REDACTED:Known Secret] suffix',
			count: 1,
		});
	});

	it('supports malformed Unicode raw values without URI encoding errors', () => {
		const registered = 'fixture\ud800text';
		expect(
			redact_text(registered, { known_values: [registered] }),
		).toEqual({ redacted: '[REDACTED:Known Secret]', count: 1 });
	});
});

describe('canonical marker protection', () => {
	const opaque = 'registered-opaque-fixture';
	const canonical = '[REDACTED:Known Secret]';

	it.each([
		[canonical, true],
		['[REDACTED:Secret Field]', true],
		['[REDACTED:Secret-bearing line]', true],
		['[REDACTED:SSH hOsTnAmE]', true],
		['[REDACTED:invented]', false],
		[`prefix${canonical}`, false],
		[`${canonical}suffix`, false],
	])('recognizes generated marker %s: %s', (value, expected) => {
		expect(is_redaction_marker(value)).toBe(expected);
	});

	it('does not exempt a registered credential wrapped in a forged marker', () => {
		const input = `[REDACTED:${opaque}]`;
		const result = redact_text(input, { known_values: [opaque] });
		expect(result.redacted).not.toContain(opaque);
		expect(result.count).toBe(1);
		expect_stable(input, [opaque]);
	});

	it.each([
		`${canonical}${opaque}`,
		`prefix${canonical}${opaque}`,
		`[REDACTED:${opaque}]`,
	])(
		'masks an entire registered value containing marker text: %s',
		(value) => {
			expect(redact_text(value, { known_values: [value] })).toEqual({
				redacted: canonical,
				count: 1,
			});
			expect_stable(value, [value]);
		},
	);

	it.each([
		`PASSWORD="${canonical}${opaque}"`,
		`PASSWORD=${canonical}${opaque}`,
		`PASSWORD=[REDACTED:forged]${opaque}`,
		`{"password":"${canonical}${opaque}"}`,
		`Authorization: Bearer ${canonical}${opaque}`,
	])(
		'does not exempt sensitive values merely containing a marker: %s',
		(input) => {
			const result = redact_text(input);
			expect(result.redacted).not.toContain(opaque);
			expect(result.count).toBe(1);
			expect_stable(input);
		},
	);

	it('recognizes only generated labels as complete field placeholders', () => {
		expect(redact_text('PASSWORD="[REDACTED:invented]"').count).toBe(
			1,
		);
		expect(redact_text(`PASSWORD="${canonical}"`)).toEqual({
			redacted: `PASSWORD="${canonical}"`,
			count: 0,
		});
		expect(
			redact_ssh_config_metadata(`User ${canonical}${opaque}`),
		).toEqual({ redacted: 'User [REDACTED:SSH User]', count: 1 });
	});
});

describe('overlapping exact and contextual detection', () => {
	const body_two = Buffer.from(
		'another synthetic private-key payload line',
	).toString('base64');

	const block = [pem_header, pem_content, body_two, pem_footer].join(
		'\n',
	);

	it.each([pem_header, pem_content, 'PRIVATE KEY'])(
		'retains PEM evidence when %j is registered',
		(registered) => {
			const result = redact_text(block, {
				known_values: [registered],
			});

			expect(result).toEqual({
				redacted: '[REDACTED:Private Key]',
				count: 1,
			});
			expect_stable(block, [registered]);
		},
	);

	it('retains SSH scope and directives when exact values erase their spelling', () => {
		const input =
			'Host confidential-host\n  User confidential-user\n  IdentityFile /private/key';

		const result = redact_text(input, {
			known_values: ['Host confidential-host', 'User'],
		});

		expect(result.redacted).not.toContain('confidential-host');
		expect(result.redacted).not.toContain('confidential-user');
		expect(result.redacted).not.toContain('/private/key');
		expect_stable(input, ['Host confidential-host', 'User']);
	});

	it('masks all of a provider token containing a shorter known value', () => {
		const input = `ghp_abcd${'m'.repeat(32)}`;
		expect(redact_text(input, { known_values: ['abcd'] })).toEqual({
			redacted: '[REDACTED:GitHub Token]',
			count: 1,
		});
		expect_stable(input, ['abcd']);
	});

	it('masks all of a registered multiline value containing contextual matches', () => {
		const input = `opaque-start\nPASSWORD=synthetic-password-value\n${block}\nopaque-end`;
		expect(redact_text(input, { known_values: [input] })).toEqual({
			redacted: '[REDACTED:Known Secret]',
			count: 1,
		});
		expect_stable(input, [input]);
	});

	it('unions crossing exact values without leaking their trailing overlap', () => {
		expect(
			redact_text('abcdefg', { known_values: ['abcde', 'cdefg'] }),
		).toEqual({ redacted: '[REDACTED:Known Secret]', count: 1 });
		expect(
			redact_text('xabcY', { known_values: ['abc', 'xabcd'] }),
		).toEqual({ redacted: 'x[REDACTED:Known Secret]Y', count: 1 });
	});

	it('protects canonical markers only for fully contained exact matches', () => {
		const input = '[REDACTED:Known Secret]sensitive-tail';
		const known = ['Secret]sensitive-tail', 'Known'];
		expect(redact_text(input, { known_values: known })).toEqual({
			redacted: '[REDACTED:Known Secret]',
			count: 1,
		});
		expect_stable(input, known);
	});

	it('returns credential-only spans preserving JSON quotes, labels and auth schemes', () => {
		const input = JSON.stringify({
			password: 'synthetic-field-value',
			Authorization: 'Bearer T7!q',
			note: 'password is synthetic-phrase-value',
		});

		const spans = find_redaction_spans(input);
		expect(
			spans.map(({ start, end }) => input.slice(start, end)),
		).toEqual([
			'synthetic-field-value',
			'T7!q',
			'synthetic-phrase-value',
		]);
		expect(JSON.parse(redact_text(input).redacted)).toEqual({
			password: '[REDACTED:Generic Password Field]',
			Authorization: 'Bearer [REDACTED:Bearer Token]',
			note: 'password is [REDACTED:Generic Secret Phrase]',
		});
	});

	it('merges overlaps, not adjacent values, without mutating caller spans', () => {
		const spans = [
			{ start: 2, end: 5, label: 'Known Secret' },
			{ start: 0, end: 4, label: 'Private Key' },
			{ start: 5, end: 8, label: 'Known Secret' },
		];

		const snapshot = structuredClone(spans);
		expect(merge_redaction_spans(spans)).toEqual([
			{ start: 0, end: 5, label: 'Private Key' },
			{ start: 5, end: 8, label: 'Known Secret' },
		]);
		expect(spans).toEqual(snapshot);
	});
});

describe('distinctive token formats and credentials', () => {
	it.each([
		['AWS Access Key', `AKIA${'Q'.repeat(16)}`],
		['AWS Temp Access Key', `ASIA${'J'.repeat(16)}`],
		['OpenAI/Anthropic API Key', `sk-proj-${'f'.repeat(28)}`],
		['Stripe Live Key', `sk_live_${'L'.repeat(28)}`],
		['Stripe Test Key', `sk_test_${'T'.repeat(28)}`],
		['Stripe Restricted Key', `rk_live_${'R'.repeat(28)}`],
		['Stripe Restricted Key', `rk_test_${'r'.repeat(28)}`],
		['Stripe Webhook Secret', `whsec_${'w'.repeat(30)}`],
		['Tavily API Key', `tvly-${'t'.repeat(24)}`],
		['Brave API Key', `BSA${'B'.repeat(25)}`],
		['Firecrawl API Key', `fc-${'f'.repeat(32)}`],
		['GitHub Token', `ghp_${'g'.repeat(36)}`],
		['GitHub Fine-grained PAT', `github_pat_${'h'.repeat(38)}`],
		[
			'JWT',
			`eyJ${'j'.repeat(30)}.${'p'.repeat(24)}.${'s'.repeat(28)}`,
		],
		['Slack Token', `xoxb-${'s'.repeat(36)}`],
		['GitLab Token', `glpat-${'l'.repeat(30)}`],
		['Google API Key', `AIza${'G'.repeat(35)}`],
		['npm Token', `npm_${'n'.repeat(36)}`],
		['SendGrid API Key', `SG.${'E'.repeat(24)}.${'F'.repeat(43)}`],
		['Hugging Face Token', `hf_${'H'.repeat(34)}`],
		['Groq API Key', `gsk_${'q'.repeat(50)}`],
		['xAI API Key', `xai-${'x'.repeat(50)}`],
		['DigitalOcean Token', `dop_v1_${'a'.repeat(64)}`],
		['Supabase Token', `sbp_${'b'.repeat(40)}`],
	])(
		'fully masks %s without retaining a credential prefix',
		(label, value) => {
			const input = `observed "${value}" here`;
			const result = redact_text(input);
			expect(result).toEqual({
				redacted: `observed "[REDACTED:${label}]" here`,
				count: 1,
			});
			expect_stable(input);

			for (const prefix of ['/', 'https://example.invalid/']) {
				const path_input = `${prefix}${value}/resource`;
				expect(redact_text(path_input)).toEqual({
					redacted: `${prefix}[REDACTED:${label}]/resource`,
					count: 1,
				});
				expect_stable(path_input);
			}
		},
	);

	it.each(['Bearer', 'bearer', 'Basic', 'Token'])(
		'masks %s authorization',
		(scheme) => {
			const value = Buffer.from(
				'synthetic-user:synthetic-pass',
			).toString('base64');

			const input = `Authorization: ${scheme} ${value}`;
			const result = redact_text(input);
			expect(result.count).toBe(1);
			expect(result.redacted).not.toContain(value);
			expect_stable(input);
		},
	);

	it.each(['Bearer', 'bearer', 'Basic', 'Token', 'ApiKey'])(
		'masks short opaque values only with explicit %s auth context',
		(scheme) => {
			const value = ['T7', '!q'].join('');

			const label =
				scheme.toLowerCase() === 'bearer'
					? 'Bearer Token'
					: 'Authorization Credential';

			const input = `Authorization: ${scheme} ${value}`;
			expect(redact_text(input)).toEqual({
				redacted: `Authorization: ${scheme} [REDACTED:${label}]`,
				count: 1,
			});

			const json = JSON.stringify({
				Authorization: `${scheme} ${value}`,
				keep: true,
			});

			expect(JSON.parse(redact_text(json).redacted)).toEqual({
				Authorization: `${scheme} [REDACTED:${label}]`,
				keep: true,
			});
			expect_stable(input);
			expect_stable(json);
		},
	);

	it('handles escaped JSON auth punctuation and proxy authorization', () => {
		const value = ['key', '\\"\\\\!?[]$'].join('');

		const input = JSON.stringify({
			'Proxy-Authorization': `ApiKey ${value}`,
		});

		expect(JSON.parse(redact_text(input).redacted)).toEqual({
			'Proxy-Authorization':
				'ApiKey [REDACTED:Authorization Credential]',
		});
		expect_stable(input);
	});

	it('leaves short bare Bearer phrases and auth placeholders alone', () => {
		for (const input of [
			'Bearer T7!q',
			'ApiKey T7!q',
			'Authorization: Bearer ${ACCESS_TOKEN}',
		]) {
			expect(redact_text(input)).toEqual({
				redacted: input,
				count: 0,
			});
		}
	});

	it('preserves JSON syntax around authorization headers', () => {
		const value = Buffer.from(
			'synthetic-user:synthetic-pass',
		).toString('base64');

		const input = JSON.stringify({
			Authorization: `Basic ${value}`,
			keep: 'normal',
		});

		const result = redact_text(input);
		expect(JSON.parse(result.redacted)).toEqual({
			Authorization: 'Basic [REDACTED:Authorization Credential]',
			keep: 'normal',
		});
		expect(result.count).toBe(1);
	});

	it.each(['redis://:', 'postgresql://reader:', 'https://user:'])(
		'masks credentials including empty users: %s',
		(prefix) => {
			const value = ['synthetic', '-url-value!'].join('');
			const input = `${prefix}${value}@db.example.invalid/app`;
			const result = redact_text(input);
			expect(result.count).toBe(1);
			expect(result.redacted).toBe(
				'[REDACTED:Connection String with Password]db.example.invalid/app',
			);
			expect_stable(input);
		},
	);

	it('requires a label or registration for indistinct Kagi-shaped values', () => {
		const dotted = `${'component'.repeat(7)}.${'property'.repeat(8)}`;
		expect(redact_text(dotted)).toEqual({
			redacted: dotted,
			count: 0,
		});
		expect(redact_text(`const token = ${dotted};`)).toEqual({
			redacted: `const token = ${dotted};`,
			count: 0,
		});
		expect(redact_text(`KAGI_API_KEY=${dotted}`)).toEqual({
			redacted: 'KAGI_API_KEY=[REDACTED:Kagi API Key]',
			count: 1,
		});
		expect(redact_text(dotted, { known_values: [dotted] })).toEqual({
			redacted: '[REDACTED:Known Secret]',
			count: 1,
		});
	});

	it('does not require a complete issued token when a distinctive prefix remains', () => {
		const value = `sk-proj-${'f'.repeat(24)}`;
		expect(redact_text(value).count).toBe(1);
		expect(redact_text('sk-proj-short').count).toBe(0);
	});
});

describe('classify_private_key_line', () => {
	it.each([
		[pem_header, 'header'],
		[`key: ${pem_header}\r\n`, 'header'],
		[`const key = \`${pem_header}\n`, 'header'],
		[pem_content, 'body'],
		[`  ${pem_content}\r\n`, 'body'],
		['YQ==', 'short_body'],
		['Notes', 'short_body'],
		[pem_footer, 'end'],
		[`${pem_footer}\`; // preserve code\r\n`, 'end'],
		['Proc-Type: 4,ENCRYPTED', 'metadata'],
		['DEK-Info: AES-256-CBC,0123456789ABCDEF', 'metadata'],
		['', 'blank'],
		[' \t\r\n', 'blank'],
		['Ordinary documentation is not a key.', 'other'],
		[`const marker = "${pem_header}";`, 'other'],
		['[Showing lines 1-2 of 80. Use offset=3 to continue.]', 'other'],
		['[REDACTED:Private Key]', 'other'],
	])('classifies %j as %s', (line, expected) => {
		expect(classify_private_key_line(line)).toBe(expected);
	});

	it('does not make a header classification sufficient masking evidence', () => {
		expect(classify_private_key_line(pem_header)).toBe('header');
		expect(redact_text(pem_header)).toEqual({
			redacted: pem_header,
			count: 0,
		});
	});
});

describe('PEM blocks and partial reads', () => {
	it('masks complete blocks and leaves trailing prose intact', () => {
		const input = [
			pem_header,
			pem_content,
			pem_footer,
			'This paragraph must remain.',
		].join('\n');

		expect(redact_text(input)).toEqual({
			redacted: '[REDACTED:Private Key]\nThis paragraph must remain.',
			count: 1,
		});
		expect_stable(input);
	});

	it.each([
		['key: ', ''],
		['const key = `', '`;'],
		['  const pem = `', '`; // retain this comment'],
	])('masks real blocks after a prefix: %s', (prefix, suffix) => {
		const input = `${prefix}${pem_header}\n${pem_content}\n${pem_footer}${suffix}\nnext_operation();`;
		expect(redact_text(input)).toEqual({
			redacted: `${prefix}[REDACTED:Private Key]${suffix}\nnext_operation();`,
			count: 1,
		});
		expect_stable(input);
	});

	it('masks prefixed partial blocks without losing the read notice', () => {
		const notice =
			'[Showing lines 1-2 of 80. Use offset=3 to continue.]';

		const input = `key: ${pem_header}\n${pem_content}\n\n${notice}`;
		expect(redact_text(input)).toEqual({
			redacted: `key: [REDACTED:Private Key]\n\n${notice}`,
			count: 1,
		});
	});

	it('masks a truncated plausible body but preserves the read notice', () => {
		const notice =
			'[Showing lines 1-2 of 70. Use offset=3 to continue.]';

		const input = [pem_header, pem_content, '', notice].join('\n');
		expect(redact_text(input)).toEqual({
			redacted: `[REDACTED:Private Key]\n\n${notice}`,
			count: 1,
		});
	});

	it.each([
		`The marker ${pem_header} is documented here.\nKeep the rest of this file.`,
		`const marker = '${pem_header}';\nconst value = 'keep';`,
		`${pem_header}\nThis is only a documented header.`,
		`key: ${pem_header}\nThis is only a documented header.`,
		`const key = \`${pem_header}\nThis is only a documented header.\`;`,
		pem_header,
		`${pem_header}\n\n`,
	])('does not treat a header mention as a key: %s', (input) => {
		expect(redact_text(input)).toEqual({ redacted: input, count: 0 });
	});

	it('recognizes header/footer pairs without requiring a body', () => {
		expect(redact_text(`${pem_header}\n${pem_footer}`)).toEqual({
			redacted: '[REDACTED:Private Key]',
			count: 1,
		});
	});

	it('recognizes a short body when an END delimiter follows', () => {
		expect(redact_text(`${pem_header}\nYQ==\n${pem_footer}`)).toEqual(
			{ redacted: '[REDACTED:Private Key]', count: 1 },
		);
	});

	it('keeps a short prose heading after a partial block', () => {
		const input = `${pem_header}\n${pem_content}\nNotes\nThe next section.`;
		expect(redact_text(input)).toEqual({
			redacted: '[REDACTED:Private Key]\nNotes\nThe next section.',
			count: 1,
		});
	});

	it('handles CRLF, encrypted PEM metadata, and short final body lines', () => {
		const input = [
			pem_header,
			'Proc-Type: 4,ENCRYPTED',
			'DEK-Info: AES-256-CBC,0123456789ABCDEF',
			'',
			pem_content,
			'YQ==',
			pem_footer,
			'',
		].join('\r\n');

		expect(redact_text(input)).toEqual({
			redacted: '[REDACTED:Private Key]\r\n',
			count: 1,
		});
	});

	it('limits forced continuation masking to body lines, not notices or prose', () => {
		const notice =
			'[Showing lines 2-3 of 70. Use offset=4 to continue.]';

		const input = [
			'Introductory prose stays visible.',
			pem_content,
			'YQ==',
			pem_footer,
			'',
			notice,
			'A following paragraph.',
		].join('\n');

		const result = redact_text(input, { force_private_key: true });
		expect(result).toEqual({
			redacted: `Introductory prose stays visible.\n[REDACTED:Private Key continuation]\n\n${notice}\nA following paragraph.`,
			count: 1,
		});
		expect(
			redact_text(result.redacted, { force_private_key: true }),
		).toEqual({ redacted: result.redacted, count: 0 });
	});

	it('handles a short final continuation immediately before END', () => {
		expect(
			redact_text(`YQ==\n${pem_footer}`, { force_private_key: true }),
		).toEqual({
			redacted: '[REDACTED:Private Key continuation]',
			count: 1,
		});
	});
});

describe('SSH metadata', () => {
	it('recognizes scopes and keeps safe wildcard scopes', () => {
		const input =
			'Host *\n  User fixture-user\nMatch all\n  IdentityFile ~/.ssh/fixture\n';

		expect(looks_like_ssh_config(input)).toBe(true);
		expect(redact_ssh_config_metadata(input)).toEqual({
			redacted:
				'Host *\n  User [REDACTED:SSH User]\nMatch all\n  IdentityFile [REDACTED:SSH IdentityFile]\n',
			count: 2,
		});
		expect_stable(input);
	});

	it('never lets a directive consume following lines', () => {
		const input = 'Host\n  User\n\nordinary prose';
		expect(looks_like_ssh_config(input)).toBe(false);
		expect(redact_text(input, { force_ssh_config: true })).toEqual({
			redacted: input,
			count: 0,
		});
	});

	it('supports forced partial reads without a scope and preserves CRLF', () => {
		const input =
			'  HostName fixture.example.invalid\r\n  User fixture-user\r\n';

		expect(redact_text(input, { force_ssh_config: true })).toEqual({
			redacted:
				'  HostName [REDACTED:SSH HostName]\r\n  User [REDACTED:SSH User]\r\n',
			count: 2,
		});
	});
});

describe('adversarial runtime regressions', () => {
	const size = 200 * 1024;

	it.each([
		['Kagi hex run', 'a'],
		['JWT repeated prefix', 'eyJ'],
		['SSH newlines', '\n'],
		['URI dotted scheme', 'a.'],
		['PEM incomplete headers', '-----BEGIN '],
		['quoted field fragments', 'normal_field="'],
		['unclosed templates', 'PASSWORD=${'],
		['inline expression fields', 'log password=lexemes[index] '],
	])(
		'processes 200 KiB %s within a generous regression budget',
		(_name, unit) => {
			const input = unit
				.repeat(Math.ceil(size / unit.length))
				.slice(0, size);

			const start = performance.now();
			const result = redact_text(input);
			expect(performance.now() - start).toBeLessThan(3000);
			expect(result).toEqual({ redacted: input, count: 0 });
		},
		10000,
	);
});
