export const MINIMUM_NODE_VERSION = '24.15.0';

function parse_node_version(
	version: string,
): [number, number, number] | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function is_supported_node_version(version: string): boolean {
	const current = parse_node_version(version);
	const minimum = parse_node_version(MINIMUM_NODE_VERSION);
	if (!current || !minimum) return false;

	for (let index = 0; index < current.length; index++) {
		if (current[index] > minimum[index]) return true;
		if (current[index] < minimum[index]) return false;
	}
	return true;
}

export function get_node_preflight_error(
	current_version = process.versions.node,
): string | undefined {
	if (is_supported_node_version(current_version)) return undefined;
	return `my-pi requires Node >=${MINIMUM_NODE_VERSION}; current version is ${current_version}. Upgrade Node and retry.`;
}
