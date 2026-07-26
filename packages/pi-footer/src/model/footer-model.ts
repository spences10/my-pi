import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import type { GitIconMode } from '../presets/types.js';
import { error, warning, type FooterTheme } from '../theme/tokens.js';
import { format_token_count } from '../utils/text.js';
import {
	format_git_summary,
	get_git_summary,
	type GitSummary,
} from './git.js';
import { get_current_thinking_level } from './thinking.js';

export interface FooterModel {
	cwd: string;
	path_text: string;
	git: GitSummary;
	git_text?: string;
	session_text?: string;
	token_parts: string[];
	cost_text?: string;
	context_text: string;
	model_name: string;
	provider?: string;
	thinking_text?: string;
	model_text: string;
	statuses: Map<string, string>;
	preset_status?: string;
}

export function build_footer_model(
	ctx: ExtensionContext,
	footer_data: ReadonlyFooterDataProvider,
	theme: FooterTheme,
	git_icon_mode: GitIconMode = 'nerd',
): FooterModel {
	let total_input = 0;
	let total_output = 0;
	let total_cache_read = 0;
	let total_cache_write = 0;
	let total_cost = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		const usage =
			entry.type === 'message'
				? entry.message.role === 'assistant' ||
					entry.message.role === 'toolResult'
					? entry.message.usage
					: undefined
				: entry.type === 'compaction' ||
					  entry.type === 'branch_summary'
					? entry.usage
					: undefined;
		if (!usage) continue;
		total_input += usage.input;
		total_output += usage.output;
		total_cache_read += usage.cacheRead;
		total_cache_write += usage.cacheWrite;
		total_cost += usage.cost.total;
	}

	const context_usage = ctx.getContextUsage();
	const context_window =
		context_usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const context_percent_value = context_usage?.percent ?? 0;
	const context_percent =
		context_usage?.percent !== null
			? context_percent_value.toFixed(1)
			: '?';

	let path_text = ctx.cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && path_text.startsWith(home)) {
		path_text = `~${path_text.slice(home.length)}`;
	}

	const git_branch = footer_data.getGitBranch() ?? undefined;
	const git = get_git_summary(ctx.cwd, git_branch);
	const git_text = format_git_summary(git, git_icon_mode);
	const session_text =
		ctx.sessionManager.getSessionName() || undefined;

	const token_parts: string[] = [];
	if (total_input)
		token_parts.push(`↑${format_token_count(total_input)}`);
	if (total_output)
		token_parts.push(`↓${format_token_count(total_output)}`);
	if (total_cache_read)
		token_parts.push(`R${format_token_count(total_cache_read)}`);
	if (total_cache_write)
		token_parts.push(`W${format_token_count(total_cache_write)}`);

	const using_subscription = ctx.model
		? ctx.modelRegistry.isUsingOAuth(ctx.model)
		: false;
	const cost_text =
		total_cost || using_subscription
			? `$${total_cost.toFixed(3)}${using_subscription ? ' (sub)' : ''}`
			: undefined;

	const context_percent_display =
		context_percent === '?'
			? `?/${format_token_count(context_window)}`
			: `${context_percent}%/${format_token_count(context_window)}`;
	let context_text = context_percent_display;
	if (context_percent_value > 90) {
		context_text = error(theme, context_percent_display);
	} else if (context_percent_value > 70) {
		context_text = warning(theme, context_percent_display);
	}

	const model_name = ctx.model?.id || 'no-model';
	const thinking_level = get_current_thinking_level(ctx);
	const thinking_text = ctx.model?.reasoning
		? thinking_level === 'off'
			? 'thinking off'
			: thinking_level
		: undefined;
	let model_text = model_name;
	if (thinking_text) model_text = `${model_name} • ${thinking_text}`;
	if (footer_data.getAvailableProviderCount() > 1 && ctx.model) {
		model_text = `(${ctx.model.provider}) ${model_text}`;
	}

	const statuses = new Map(footer_data.getExtensionStatuses());
	const preset_status = statuses.get('preset');
	statuses.delete('preset');

	return {
		cwd: ctx.cwd,
		path_text,
		git,
		git_text,
		session_text,
		token_parts,
		cost_text,
		context_text,
		model_name,
		provider: ctx.model?.provider,
		thinking_text,
		model_text,
		statuses,
		preset_status,
	};
}
