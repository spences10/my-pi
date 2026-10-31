// Variants and prop types live in button.svelte's module script;
// import them from there, as type-aware lint can't see .svelte
// exports through this file.
import Root from './button.svelte';

export {
	Root,
	//
	Root as Button,
};
