#!/usr/bin/env node
import { main } from '@earendil-works/pi-coding-agent';
import { extensions } from './extensions.js';

process.title = 'my-pi';
process.env.PI_CODING_AGENT = 'true';
process.env.AI_AGENT = 'pi';
// Same as upstream's CLI: hides node:sqlite's ExperimentalWarning.
process.emitWarning = () => {};
// my-pi pins its Pi version, so upstream's update notice does not apply.
process.env.PI_SKIP_VERSION_CHECK ??= '1';

await main(process.argv.slice(2), { extensionFactories: extensions });
