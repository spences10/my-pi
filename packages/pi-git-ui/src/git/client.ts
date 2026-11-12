import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);

export async function git(
	args: string[],
	cwd: string,
): Promise<string> {
	const { stdout } = await exec_file('git', args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 1024 * 1024 * 8,
	});

	return stdout;
}

export async function git_with_input(
	args: string[],
	cwd: string,
	input: string,
): Promise<string> {
	return await new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd, stdio: 'pipe' });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(stdout);
			else
				reject(new Error(stderr || `git exited with status ${code}`));
		});
		child.stdin.end(input);
	});
}
