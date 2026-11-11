import { losslessCompressPngSync } from '@napi-rs/image';
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	load_preview_config,
	parse_preview_config,
	type PreviewConfig,
} from './config.ts';
import { render_preview_svg } from './render.ts';

export { render_preview_svg } from './render.ts';

export const preview_help = `Usage: pnpm run preview:generate [options]

  --config <path>          JSON overrides for assets/pi-package-preview.config.json
  --output, -o <path>       PNG destination (default: assets/pi-package-preview.png)
  --model <text>           Model label
  --project <text>         Project label
  --border / --no-border   Show or hide the outer frame
  --border-color <hex>     Solid frame colour; clears any gradient
  --border-gradient <hex,hex,...>
                          Frame gradient (2–8 colour stops)
  --border-width <number>  Frame stroke width (0.5–8)
  --border-radius <number> Frame corner radius (0–32)
  --footer / --no-footer   Show or hide the footer
  --footer-color <hex>     Footer text and divider colour
  --footer-separator / --no-footer-separator
                          Show or hide the footer divider
  --footer-editor / --no-footer-editor
                          Show or hide the illustrative editor and cursor
  --footer-left <text>     Override the first footer row's left text
  --footer-right <text>    Override the first footer row's right text
  --check                 Check freshness without writing files
  --help, -h              Show this help

Precedence: checked-in defaults < --config JSON < CLI flags.
Footer text supports {version}, {model}, and {project}; no code is executed.
The version always comes from packages/my-pi/package.json.
`;

type PreviewOptions =
	| { help: true }
	| {
			help: false;
			check: boolean;
			output_path: string;
			config: PreviewConfig;
	  };

function numeric(
	value: string | undefined,
	flag: string,
): number | undefined {
	if (value === undefined) return undefined;

	if (value.trim() === '' || !Number.isFinite(Number(value))) {
		throw new Error(`${flag} must be a number.`);
	}

	return Number(value);
}

export function preview_options(args: string[]): PreviewOptions {
	const { values } = parseArgs({
		args: args[0] === '--' ? args.slice(1) : args,
		strict: true,
		allowPositionals: false,
		allowNegative: true,
		options: {
			config: { type: 'string' },
			output: { type: 'string', short: 'o' },
			model: { type: 'string' },
			project: { type: 'string' },
			border: { type: 'boolean' },
			'border-color': { type: 'string' },
			'border-gradient': { type: 'string' },
			'border-width': { type: 'string' },
			'border-radius': { type: 'string' },
			footer: { type: 'boolean' },
			'footer-color': { type: 'string' },
			'footer-separator': { type: 'boolean' },
			'footer-editor': { type: 'boolean' },
			'footer-left': { type: 'string' },
			'footer-right': { type: 'string' },
			check: { type: 'boolean' },
			help: { type: 'boolean', short: 'h' },
		},
	});

	if (values.help) return { help: true };
	const base = load_preview_config(values.config);
	const first_row = base.footer.rows[0] ?? { left: '', right: '' };

	const config = parse_preview_config(
		{
			model: values.model,
			project: values.project,
			border: {
				enabled: values.border,
				color: values['border-color'],
				gradient: values['border-gradient']
					?.split(',')
					.map((stop) => stop.trim()),
				width: numeric(values['border-width'], '--border-width'),
				radius: numeric(values['border-radius'], '--border-radius'),
			},
			footer: {
				enabled: values.footer,
				separator: values['footer-separator'],
				editor: values['footer-editor'],
				color: values['footer-color'],
				rows:
					values['footer-left'] !== undefined ||
					values['footer-right'] !== undefined
						? [
								{
									left: values['footer-left'] ?? first_row.left,
									right: values['footer-right'] ?? first_row.right,
								},
								...base.footer.rows.slice(1),
							]
						: undefined,
			},
		},
		base,
	);

	return {
		help: false,
		check: values.check ?? false,
		output_path: resolve(
			values.output ??
				fileURLToPath(
					new URL(
						'../../assets/pi-package-preview.png',
						import.meta.url,
					),
				),
		),
		config,
	};
}

const package_path = new URL(
	'../../packages/my-pi/package.json',
	import.meta.url,
);

function sha256(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}

function preview_source(version: string, config: PreviewConfig) {
	const resolved = parse_preview_config(config);
	const svg = render_preview_svg(version, resolved);

	return {
		svg,
		config_sha256: sha256(JSON.stringify(resolved)),
		source_sha256: sha256(svg),
	};
}

export function generate_preview(
	version: string,
	output_path: string,
	config: PreviewConfig = load_preview_config(),
): void {
	const { svg, ...fingerprints } = preview_source(version, config);

	const png = new Resvg(svg, { fitTo: { mode: 'original' } })
		.render()
		.asPng();

	const optimized = losslessCompressPngSync(png);
	mkdirSync(dirname(output_path), { recursive: true });
	writeFileSync(output_path, optimized);
	writeFileSync(
		`${output_path}.json`,
		`${JSON.stringify(
			{
				version,
				...fingerprints,
				image_sha256: sha256(optimized),
			},
			null,
			'\t',
		)}\n`,
	);
}

export function check_preview(
	version: string,
	output_path: string,
	config: PreviewConfig = load_preview_config(),
): boolean {
	try {
		const expected = preview_source(version, config);

		const metadata = JSON.parse(
			readFileSync(`${output_path}.json`, 'utf8'),
		);

		return (
			metadata.version === version &&
			metadata.config_sha256 === expected.config_sha256 &&
			metadata.source_sha256 === expected.source_sha256 &&
			metadata.image_sha256 === sha256(readFileSync(output_path))
		);
	} catch {
		return false;
	}
}

if (import.meta.main) {
	try {
		const options = preview_options(process.argv.slice(2));

		if (options.help) {
			console.log(preview_help);
		} else {
			const { version } = JSON.parse(
				readFileSync(package_path, 'utf8'),
			) as { version: string };

			if (options.check) {
				if (
					!check_preview(version, options.output_path, options.config)
				) {
					console.error(
						'Package preview is stale. Run pnpm run preview:generate with the same config and overrides.',
					);
					process.exitCode = 1;
				} else {
					console.log(
						`Package preview is current (my-pi v${version}).`,
					);
				}
			} else {
				generate_preview(
					version,
					options.output_path,
					options.config,
				);
				console.log(
					`Generated ${options.output_path} for my-pi v${version}.`,
				);
			}
		}
	} catch (error) {
		console.error(
			error instanceof Error
				? error.message
				: 'Preview generation failed.',
		);
		process.exitCode = 1;
	}
}
