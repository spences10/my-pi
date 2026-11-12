import { redact_text } from '@spences10/pi-redact';
import type { WorkerInfo } from './manager.js';

export function diagnostic_text(text: string): string {
	return redact_text(text).redacted;
}

export function diagnostic_error(cause: unknown): Error {
	// Do not retain the raw error as a cause: diagnostics can contain secrets.
	return new Error(
		diagnostic_text(
			cause instanceof Error ? cause.message : String(cause),
		),
	);
}

export function worker_snapshot(info: WorkerInfo): WorkerInfo {
	// WorkerInfo is flat; sanitize every string, including child-supplied paths.
	const { pid: _pid, ...text_fields } = info;

	const sanitized = Object.fromEntries(
		Object.entries(text_fields).map(([key, value]) => [
			key,
			value === undefined ? undefined : diagnostic_text(value),
		]),
	);

	return Object.assign({}, info, sanitized);
}
