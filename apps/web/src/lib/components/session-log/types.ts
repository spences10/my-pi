export type Hunk = {
	before?: string[];
	after?: string[];
};

type TextTurn = {
	role: 'user' | 'assistant' | 'working';
	text: string;
};
type ReadTurn = {
	role: 'read';
	path: string;
	range?: string;
	code: string;
	// Fence metadata for marked lines, for example `{5}`.
	highlight?: string;
	lines_below?: number;
};
type BashTurn = {
	role: 'bash';
	command: string;
	output?: string;
	exit_code?: number;
};

export type Turn =
	| TextTurn
	| ReadTurn
	| BashTurn
	| { role: 'diff'; path: string; hunks: Hunk[] };

export type RenderedTurn =
	| TextTurn
	| (Omit<ReadTurn, 'code' | 'highlight'> & { html: string })
	| (BashTurn & { command_html: string })
	| { role: 'diff'; path: string; html: string };
