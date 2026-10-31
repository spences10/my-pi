// Variants and prop types live in toggle.svelte's module script;
// import them from there, as type-aware lint can't see .svelte
// exports through this file.
import Root from './toggle.svelte';

export {
	Root,
	//
	Root as Toggle,
};
