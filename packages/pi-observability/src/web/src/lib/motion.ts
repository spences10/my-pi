import { cubicOut } from 'svelte/easing';
import { prefersReducedMotion } from 'svelte/motion';
import { slide, type SlideParams } from 'svelte/transition';

/**
 * Slide for opening and closing sections. Honours the system's reduced
 * motion setting by skipping the animation.
 */
export function slide_open(node: Element, params: SlideParams = {}) {
	return slide(node, {
		duration: prefersReducedMotion.current ? 0 : 220,
		easing: cubicOut,
		...params,
	});
}
