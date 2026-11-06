// Public integration surface for owned RPC workers. Both extensions use the
// same mailbox and recipient policy, including when Team Mode is not loaded.
export {
	get_coordination_db_path,
	should_auto_inject_messages,
} from './config.js';
export { CoordinationPoller } from './coordination-poller.js';
export { TeamDatabase } from './db/index.js';
export { render_peer_message } from './rendering.js';
