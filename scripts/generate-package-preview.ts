import { losslessCompressPngSync } from '@napi-rs/image';
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	preview_help,
	preview_options,
} from './package-preview-cli.ts';
import {
	load_preview_config,
	parse_preview_config,
	type PreviewConfig,
} from './package-preview-config.ts';
import { render_preview_svg } from './package-preview-design.ts';

export { render_preview_svg } from './package-preview-design.ts';

const package_path = new URL(
	'../packages/my-pi/package.json',
	import.meta.url,
);

function sha256(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}

export function generate_preview(
	version: string,
	output_path: string,
	config: PreviewConfig = load_preview_config(),
): void {
	const resolved = parse_preview_config(config);
	const svg = render_preview_svg(version, resolved);
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
				config_sha256: sha256(JSON.stringify(resolved)),
				source_sha256: sha256(svg),
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
		const resolved = parse_preview_config(config);
		const metadata = JSON.parse(
			readFileSync(`${output_path}.json`, 'utf8'),
		);
		return (
			metadata.version === version &&
			metadata.config_sha256 === sha256(JSON.stringify(resolved)) &&
			metadata.source_sha256 ===
				sha256(render_preview_svg(version, resolved)) &&
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
