/// <reference types="node" />

import { env } from 'node:process';
import config from './stryker.config.json' with { type: 'json' };

export default {
	...config,
	thresholds: {
		...config.thresholds,
		break: Number(env.MUTATION_MIN_SCORE ?? 75),
	},
};
