import { site_config } from '#lib/config/site.js';
import {
	faq_lines,
	package_groups,
	stack_rows,
} from '../page-content.js';

export const prerender = true;

const packages = package_groups
	.map(
		(group) =>
			`### ${group.label}\n\n${group.packages
				.map(
					([name, description]) =>
						`- [@spences10/${name}](${site_config.repository}/tree/main/packages/${name}): ${description}`,
				)
				.join('\n')}`,
	)
	.join('\n\n');

const llms_txt = `# ${site_config.name}

> ${site_config.description}

## Run

- Full distribution: \`pnpx my-pi@latest\` (also works with npx or bunx)
- One extension in an existing Pi setup: \`pi install npm:@spences10/pi-lsp\`

## Workflows

${stack_rows.map((row) => `- ${row.label}: ${row.body}`).join('\n')}

## Packages

${packages}

## Questions

${faq_lines.map(([question, answer]) => `- ${question} ${answer}`).join('\n')}

## Links

- [Source on GitHub](${site_config.repository})
- [my-pi on npm](${site_config.npm})
`;

export const GET = () =>
	new Response(llms_txt, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
