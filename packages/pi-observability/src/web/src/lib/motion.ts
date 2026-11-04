import { cubicOut } from 'svelte/easing';
import { prefersReducedMotion } from 'svelte/motion';
import { fly, slide, type SlideParams } from 'svelte/transition';

/** A new prompt enters above the existing trace cards. */
export function trace_enter(node: Element) {
	return fly(node, {
		y: -8,
		duration: prefersReducedMotion.current ? 0 : 180,
		easing: cubicOut,
	});
}

/** Slide sections open/closed, respecting the system's reduced motion preference. */
export function slide_open(node: Element, params: SlideParams = {}) {
	return slide(node, {
		duration: prefersReducedMotion.current ? 0 : 220,
		easing: cubicOut,
		...params,
	});
}
