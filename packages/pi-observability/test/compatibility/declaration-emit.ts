import { resolve_observability_config } from '../../src/index.js';

export function downstream_config(
	pi: Parameters<typeof resolve_observability_config>[0],
) {
	return resolve_observability_config(pi);
}
