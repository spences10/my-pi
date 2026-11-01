export const site_config = {
	name: 'my-pi',
	title: 'my-pi — a curated Pi coding-agent distribution',
	description:
		'Run upstream Pi with every @spences10/pi-* extension built in and switchable, or add individual extensions to your own Pi setup.',
	url: 'https://my-pi.dev',
	repository: 'https://github.com/spences10/my-pi',
	npm: 'https://www.npmjs.com/package/my-pi',
	author: {
		name: 'Scott Spence',
		url: 'https://github.com/spences10',
	},
	// Made by `pnpm run web:share-card` at the repository root.
	share_card: {
		path: '/og.png',
		width: 1200,
		height: 630,
		alt: 'The My-Pi logo built from coloured cubes, above the command pnpx my-pi@latest',
	},
	theme_color: '#06040f',
} as const;
