export type Hunk = {
	before?: string[];
	after?: string[];
	line_number?: number;
};

export type Turn =
	| { role: 'user' | 'assistant' | 'working'; text: string }
	| {
			role: 'read';
			path: string;
			range?: string;
			code: string;
			lines_below?: number;
	  }
	| { role: 'diff'; path: string; hunks: Hunk[] }
	| {
			role: 'bash';
			command: string;
			output?: string;
			exit_code?: number;
	  };
