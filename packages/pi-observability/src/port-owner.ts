import { execFileSync } from 'node:child_process';

export function describe_port_owner(port: number): string {
	try {
		return execFileSync(
			'lsof',
			['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
			{
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		).trim();
	} catch {
		try {
			return execFileSync('ss', ['-ltnp'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			})
				.split('\n')
				.filter((line) => line.includes(`:${port}`))
				.join('\n')
				.trim();
		} catch {
			return '';
		}
	}
}
