import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	load_preview_config,
	parse_preview_config,
	type PreviewConfig,
} from './package-preview-config.ts';

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
						'../assets/pi-package-preview.png',
						import.meta.url,
					),
				),
		),
		config,
	};
}
