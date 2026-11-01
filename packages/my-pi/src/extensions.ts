import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import confirm_destructive from '@spences10/pi-confirm-destructive';
import context from '@spences10/pi-context';
import lsp from '@spences10/pi-lsp';
import redact from '@spences10/pi-redact';

export const extensions: InlineExtension[] = [
	{ name: 'redact', factory: redact },
	{ name: 'confirm-destructive', factory: confirm_destructive },
	{ name: 'context', factory: context },
	{ name: 'lsp', factory: lsp },
];
