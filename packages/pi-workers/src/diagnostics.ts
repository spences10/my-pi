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
	return Object.fromEntries(
		Object.entries(info).map(([key, value]) => [
			key,
			typeof value === 'string' ? diagnostic_text(value) : value,
		]),
	) as WorkerInfo;
}
