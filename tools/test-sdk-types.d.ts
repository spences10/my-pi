import type {
	ExtensionContext,
	ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';

type Factory = Parameters<ExtensionUIContext['custom']>[0];

export type CustomFactory<T> = (
	tui: Parameters<Factory>[0],
	theme: Parameters<Factory>[1],
	keybindings: Parameters<Factory>[2],
	done: (result: T) => void,
) => ReturnType<Factory>;

export type ContextOverrides = Partial<
	Omit<ExtensionContext, 'ui' | 'sessionManager' | 'modelRegistry'>
> & {
	ui?: Partial<ExtensionUIContext>;
	modelRegistry?: Partial<
		Pick<
			ExtensionContext['modelRegistry'],
			keyof ExtensionContext['modelRegistry']
		>
	>;
	sessionManager?: Partial<ExtensionContext['sessionManager']>;
};
