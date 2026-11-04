import {
	definePlugin,
	defineRule,
	type ESTree,
} from 'vite-plus/lint/plugins';

export const no_nested_ternary = defineRule({
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			nested:
				'A ternary is one either/or. Move nested branching into separate if/return branches or a helper function.',
		},
	},
	create(context) {
		const reported = new Set<ESTree.ConditionalExpression>();
		return {
			ConditionalExpression(node) {
				let outer = node;
				for (
					let parent: ESTree.Node | null = node.parent;
					parent;
					parent = parent.parent
				) {
					if (
						parent.type === 'ArrowFunctionExpression' ||
						parent.type === 'FunctionExpression' ||
						parent.type === 'FunctionDeclaration'
					)
						break;
					if (parent.type === 'ConditionalExpression') outer = parent;
				}
				if (outer !== node && !reported.has(outer)) {
					context.report({ node: outer, messageId: 'nested' });
					reported.add(outer);
				}
			},
		};
	},
});

export default definePlugin({
	meta: { name: 'my-pi' },
	rules: { 'no-nested-ternary': no_nested_ternary },
});
