<script module lang="ts">
	export type { Turn } from './my-pi-terminal/types';
</script>

<script lang="ts">
	import Caret from './my-pi-terminal/caret.svelte';
	import StatusBar from './my-pi-terminal/status-bar.svelte';
	import './my-pi-terminal/styles.css';
	import TerminalTurn from './my-pi-terminal/terminal-turn.svelte';
	import type {
		Metrics,
		RenderedTurn,
		Turn,
	} from './my-pi-terminal/types';

	let {
		cwd = '~/repos/my-pi',
		branch = 'main',
		model = 'gpt-5.4',
		provider = 'openai-codex',
		effort = 'high',
		prompt_mode = 'terse',
		conversation = [],
		typing_speed = 30,
		autoplay = true,
		loop = false,
		on_complete,
		initial_metrics = {
			up: 115_000,
			down: 5_700,
			ram: 691_000,
			cost: 1.09,
			ctx_used: 36_176,
			ctx_max: 272_000,
		},
	}: {
		cwd?: string;
		branch?: string;
		model?: string;
		provider?: string;
		effort?: string;
		prompt_mode?: string;
		conversation?: Turn[];
		typing_speed?: number;
		autoplay?: boolean;
		loop?: boolean;
		on_complete?: () => void;
		initial_metrics?: Metrics;
	} = $props();

	// svelte-ignore state_referenced_locally
	const start_metrics = initial_metrics;

	let rendered = $state<RenderedTurn[]>([]);
	let active = $state<{ turn: Turn; visible: string } | null>(null);
	let working = $state<{ text: string } | null>(null);
	let input_text = $state('');
	let metrics = $state<Metrics>({ ...start_metrics });
	let done = $state(false);
	let cancelled = false;
	let run_id = 0;

	const sleep = (ms: number) =>
		new Promise<void>((r) => setTimeout(r, ms));

	function bump(turn: Turn) {
		const m = { ...metrics };
		if (turn.role === 'user') {
			m.up += 400 + Math.floor(Math.random() * 800);
			m.ctx_used += 60 + Math.floor(Math.random() * 200);
		} else if (turn.role === 'assistant') {
			m.down += 2_000 + Math.floor(Math.random() * 4_000);
			m.cost += 0.008 + Math.random() * 0.012;
			m.ctx_used += 800 + Math.floor(Math.random() * 1_500);
		} else if (turn.role === 'read' || turn.role === 'write') {
			m.down += 1_500 + Math.floor(Math.random() * 3_000);
			m.cost += 0.004 + Math.random() * 0.008;
			m.ctx_used += 1_200 + Math.floor(Math.random() * 2_000);
		} else if (turn.role === 'bash') {
			m.up += 200;
			m.down += 600;
			m.cost += 0.002;
			m.ctx_used += 400;
		} else if (turn.role === 'diff') {
			m.down += 800;
			m.cost += 0.003;
			m.ctx_used += 600;
		}
		if (m.ctx_used > m.ctx_max) m.ctx_used = m.ctx_max;
		metrics = m;
	}

	function reset() {
		cancelled = true;
		rendered = [];
		active = null;
		working = null;
		input_text = '';
		metrics = { ...start_metrics };
		done = false;
	}

	async function play() {
		const my_run = ++run_id;
		cancelled = false;
		rendered = [];
		active = null;
		working = null;
		input_text = '';
		metrics = { ...start_metrics };
		done = false;

		for (let i = 0; i < conversation.length; i++) {
			if (cancelled || my_run !== run_id) return;
			const turn = conversation[i];
			await sleep(turn.delay ?? 650);
			if (cancelled || my_run !== run_id) return;

			if (turn.role === 'user') {
				for (let ch = 0; ch <= turn.text.length; ch++) {
					if (cancelled || my_run !== run_id) return;
					input_text = turn.text.slice(0, ch);
					await sleep(typing_speed);
				}
				await sleep(450);
				input_text = '';
				rendered = [...rendered, { ...turn, id: `t-${i}` }];
				bump(turn);
			} else if (turn.role === 'assistant') {
				active = { turn, visible: '' };
				for (let ch = 0; ch <= turn.text.length; ch++) {
					if (cancelled || my_run !== run_id) return;
					active = { turn, visible: turn.text.slice(0, ch) };
					await sleep(Math.max(8, typing_speed * 0.8));
				}
				active = null;
				rendered = [...rendered, { ...turn, id: `t-${i}` }];
				bump(turn);
			} else if (turn.role === 'working') {
				working = { text: turn.text ?? 'Working...' };
				await sleep(turn.duration ?? 1400);
				if (cancelled || my_run !== run_id) return;
				working = null;
			} else {
				rendered = [...rendered, { ...turn, id: `t-${i}` }];
				bump(turn);
			}
		}

		done = true;
		on_complete?.();

		if (loop && !cancelled && my_run === run_id) {
			await sleep(2800);
			if (!cancelled && my_run === run_id) play();
		}
	}

	function slide_lifecycle(el: HTMLDivElement) {
		const section = el.closest('section');

		if (!section) {
			if (autoplay) play();
			return () => {
				cancelled = true;
			};
		}

		const on_in = () => {
			if (autoplay) play();
		};
		const on_out = () => reset();

		section.addEventListener('in', on_in);
		section.addEventListener('out', on_out);

		if (autoplay && !section.classList.contains('stack')) play();

		return () => {
			section.removeEventListener('in', on_in);
			section.removeEventListener('out', on_out);
			cancelled = true;
		};
	}

	function auto_scroll(el: HTMLDivElement) {
		const observer = new MutationObserver(() => {
			el.scrollTop = el.scrollHeight;
		});
		observer.observe(el, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		return () => observer.disconnect();
	}

	const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	let spinner_frame = $state(0);
	function spin() {
		const id = setInterval(() => {
			spinner_frame = (spinner_frame + 1) % spinner.length;
		}, 80);
		return () => clearInterval(id);
	}
</script>

<div class="term-wrap">
	<div class="terminal" {@attach slide_lifecycle}>
		<div class="scroll" {@attach auto_scroll}>
			{#each rendered as turn (turn.id)}
				<TerminalTurn {turn} />
			{/each}

			{#if active && active.turn.role === 'assistant'}
				<div class="assistant-turn">
					{active.visible}<Caret />
				</div>
			{/if}

			{#if working}
				<div class="working">
					<span class="spinner" {@attach spin}
						>{spinner[spinner_frame]}</span
					>
					<span>{working.text}</span>
				</div>
			{/if}
		</div>

		<div class="input-box">
			<span class="input-text"
				>{input_text}{#if !done}<Caret />{/if}</span
			>
		</div>

		<StatusBar
			{cwd}
			{branch}
			{provider}
			{model}
			{effort}
			{prompt_mode}
			{metrics}
		/>
	</div>
</div>
