// Canvas scene for the hero: every █ of the ASCII logo is one cube.
// All motion is a pure function of `t`, so any time can be drawn alone.

type Vec3 = [number, number, number];
export type Point = [number, number];

export interface CodeToken {
	text: string;
	type: string;
}

// Pointer input for the finished logo, in scene coordinates.
export interface HeroInteraction {
	pointer: Point | null;
	taps: { x: number; y: number; start: number }[];
	clock: number;
}

export interface HeroCopy {
	logo_lines: readonly string[];
	// Lines of real syntax tokens: each character becomes the start of a cube.
	code: readonly (readonly CodeToken[])[];
	code_path: string;
	stack: readonly (readonly [string, string])[];
	prompt: string;
	comment: string;
	headline: string;
	status: string;
	tagline: string;
}

interface Voxel {
	layer: number;
	tile: number;
	index: number;
	swarm: Vec3;
	logo: Vec3;
	burst: Vec3;
	delay: number;
	phase: number;
	spin_a: number;
	spin_b: number;
	tumble_a: number;
	tumble_b: number;
	grad_x: number;
}

interface VoxelState {
	pos: Vec3;
	half: Vec3;
	rot_a: number;
	rot_b: number;
	color: Vec3;
	lit: number;
}

interface Face {
	depth: number;
	points: Point[];
	lambert: number;
	color: Vec3;
	lit: number;
}

interface Layout {
	width: number;
	height: number;
	focal: number;
	margin: number;
	stack_cam: Vec3;
	burst_dist: number;
	logo_dist: number;
	logo_y: number;
	headline_y: number;
	tagline_y: number;
	code_size: number;
}

// Afterglow theme, as in routes/layout.css
const BG: Vec3 = [6, 4, 15];
const VIOLET: Vec3 = [157, 77, 255];
const MAGENTA: Vec3 = [255, 0, 204];
const BLUE: Vec3 = [0, 234, 255];
const GREEN: Vec3 = [204, 255, 0];
const YELLOW: Vec3 = [255, 176, 0];
const TEXT: Vec3 = [255, 247, 255];
const MUTED: Vec3 = [138, 127, 181];
const DIM: Vec3 = [71, 58, 114];
const WHITE: Vec3 = [255, 255, 255];
const GRADIENT = [GREEN, YELLOW, MAGENTA, BLUE];
const FONT = "'Victor Mono Variable', 'Victor Mono', monospace";
export const HERO_FONT = `600 40px ${FONT}`;

const FLOOR = 11;
const TAU = Math.PI * 2;
const timeline = {
	type_start: 0.4,
	char_step: 0.06,
	enter: 1.8,
	code_start: 1.9,
	code_end: 2.9,
	shatter: 3.05,
	layer_start: 5.05,
	layer_step: 0.8,
	layer_length: 0.62,
	status: 9.2,
	compress: 10.05,
	snap: 10.7,
	burst: 11.25,
	land: 12.75,
	tagline: 13.0,
	command: 13.95,
};
// Camera on the code block: the cubes start exactly on its characters.
const CODE_CAMERA = { pitch: 0.1, dist: 46 };
const TOKEN_COLORS: Record<string, Vec3> = {
	keyword: MAGENTA,
	string: GREEN,
	template: GREEN,
	type: YELLOW,
	class_name: YELLOW,
	builtin: YELLOW,
	namespace: YELLOW,
	function: BLUE,
	property: BLUE,
	number: VIOLET,
	boolean: VIOLET,
	constant: VIOLET,
	comment: MUTED,
	punctuation: MUTED,
	operator: MUTED,
};
const token_color = (type: string) => TOKEN_COLORS[type] ?? TEXT;
export const HERO_DURATION = 15.05;

const LAYOUTS: Record<'wide' | 'compact', Layout> = {
	wide: {
		width: 1920,
		height: 1080,
		focal: 1625,
		margin: 72,
		stack_cam: [690, 585, 39],
		burst_dist: 31,
		logo_dist: 44,
		logo_y: 440,
		headline_y: 172,
		tagline_y: 770,
		code_size: 34,
	},
	compact: {
		width: 1080,
		height: 1080,
		focal: 1070,
		margin: 48,
		stack_cam: [540, 480, 38],
		burst_dist: 27,
		logo_dist: 52,
		logo_y: 400,
		headline_y: 130,
		tagline_y: 660,
		code_size: 28,
	},
};

const clamp = (x: number, lo = 0, hi = 1) =>
	Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [
	lerp(a[0], b[0], u),
	lerp(a[1], b[1], u),
	lerp(a[2], b[2], u),
];
const span = (t: number, a: number, b: number) =>
	clamp((t - a) / (b - a));
const smooth = (x: number) => {
	x = clamp(x);
	return x * x * (3 - 2 * x);
};
const ease_in_out = (x: number) => {
	x = clamp(x);
	return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const ease_out = (x: number) => 1 - Math.pow(1 - clamp(x), 4);
const ease_in_back = (x: number) => {
	x = clamp(x);
	return x * x * (3.2 * x - 2.2);
};
const rgba = (c: Vec3, alpha = 1) =>
	`rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
const gradient_at = (u: number): Vec3 => {
	u = clamp(u) * 3;
	const i = Math.min(2, Math.floor(u));
	return lerp3(GRADIENT[i], GRADIENT[i + 1], u - i);
};
const lock_at = (layer: number) =>
	timeline.layer_start +
	layer * timeline.layer_step +
	timeline.layer_length;

function seeded_random(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const LIGHT = (() => {
	const v = [-0.35, -0.6, -0.72];
	const length = Math.hypot(...v);
	return v.map((x) => x / length);
})();
const CORNERS: Point[] = [
	[1, 1],
	[1, -1],
	[-1, -1],
	[-1, 1],
];

export function create_hero_scene(copy: HeroCopy) {
	const random = seeded_random(31);
	const columns = copy.logo_lines[0].length;
	const cells: { column: number; row: number }[] = [];
	copy.logo_lines.forEach((line, row) =>
		[...line].forEach((char, column) => {
			if (char === '█') cells.push({ column, row });
		}),
	);
	// Left-to-right order makes each stack layer one colour band.
	cells.sort((a, b) => a.column - b.column || a.row - b.row);
	const count = cells.length;
	const per_layer = Math.ceil(count / copy.stack.length);
	const side = Math.ceil(Math.sqrt(per_layer));
	const voxels: Voxel[] = cells.map(({ column, row }, k) => {
		const theta = random() * TAU;
		const phi = Math.acos(random() * 2 - 1);
		const radius = 0.45 + 0.55 * Math.cbrt(random());
		const swarm: Vec3 = [
			Math.sin(phi) * Math.cos(theta) * 17 * radius,
			Math.cos(phi) * 7.5 * radius - 1,
			Math.sin(phi) * Math.sin(theta) * 12 * radius,
		];
		const delay = random();
		const phase = random() * TAU;
		const spin_a = (random() - 0.5) * 2.4;
		const spin_b = (random() - 0.5) * 2.4;
		const tumble_a =
			(random() < 0.5 ? -1 : 1) *
			Math.PI *
			(1 + Math.floor(random() * 2));
		const tumble_b = (random() - 0.5) * 3;
		const burst_angle = random() * TAU;
		const burst: Vec3 = [
			Math.cos(burst_angle) * (3 + random() * 6),
			-2 - random() * 7,
			Math.abs(Math.sin(burst_angle)) * (2 + random() * 7),
		];
		return {
			layer: Math.floor(k / per_layer),
			tile: k % per_layer,
			index: k,
			swarm,
			logo: [
				column - (columns - 1) / 2,
				(row - (copy.logo_lines.length - 1) / 2) * 1.7,
				0,
			],
			burst,
			delay,
			phase,
			spin_a,
			spin_b,
			tumble_a,
			tumble_b,
			grad_x: column / (columns - 1),
		};
	});
	const dust = Array.from({ length: 150 }, () => ({
		pos: [
			(random() - 0.5) * 110,
			(random() - 0.6) * 50,
			(random() - 0.5) * 110,
		] as Vec3,
		size: 0.6 + random() * 1.6,
		phase: random() * TAU,
	}));
	// One cell for each visible character of the code.
	const code_cells: { line: number; column: number; color: Vec3 }[] =
		[];
	let code_columns = 0;
	let code_length = 0;
	copy.code.forEach((tokens, line) => {
		let column = 0;
		for (const token of tokens) {
			for (const char of token.text) {
				if (char.trim())
					code_cells.push({
						line,
						column,
						color: token_color(token.type),
					});
				column++;
			}
		}
		code_columns = Math.max(code_columns, column);
		code_length += column;
	});
	const cell_of = (v: Voxel) =>
		code_cells[
			Math.floor(((v.index + 0.5) / count) * code_cells.length)
		];

	const ripples = [
		{ start: timeline.shatter, speed: 26, gain: 0.8, color: MAGENTA },
		...copy.stack.map((_, k) => ({
			start: lock_at(k),
			speed: 15,
			gain: 0.5,
			color: MAGENTA,
		})),
		{ start: timeline.snap, speed: 20, gain: 0.6, color: MAGENTA },
		{ start: timeline.burst, speed: 46, gain: 1, color: BLUE },
		{
			start: timeline.burst + 0.12,
			speed: 30,
			gain: 0.8,
			color: MAGENTA,
		},
	];

	const stack_gap = (t: number) =>
		lerp(
			3,
			0.6,
			ease_in_back(span(t, timeline.compress, timeline.snap)),
		);
	const stack_spread = (t: number) =>
		lerp(
			2.55,
			2.32,
			smooth(span(t, timeline.compress, timeline.snap)),
		);

	function voxel_state(v: Voxel, t: number): VoxelState {
		// code character → swarm
		const out = ease_out(
			span(
				t,
				timeline.shatter + v.delay * 0.22,
				timeline.shatter + 1.05 + v.delay * 0.22,
			),
		);
		const since = t - timeline.shatter;
		const cos = Math.cos(since * 0.32);
		const sin = Math.sin(since * 0.32);
		const wx = v.swarm[0] + Math.sin(t * 0.7 + v.phase) * 1.1;
		const wy = v.swarm[1] + Math.cos(t * 0.9 + v.phase * 2);
		const wz = v.swarm[2] + Math.sin(t * 0.6 + v.phase * 3) * 1.1;
		const cell = cell_of(v);
		let pos = lerp3(
			code_position(cell.line, cell.column),
			[wx * cos - wz * sin, wy, wx * sin + wz * cos],
			out,
		);
		let half = lerp3([0.24, 0.4, 0.1], [0.78, 0.78, 0.78], out);
		let rot_a = v.spin_a * since * out;
		let rot_b = v.spin_b * since * out;
		let color = lerp3(
			cell.color,
			gradient_at(v.grad_x),
			smooth(out * 1.5),
		);
		let lit = 0.55 * out + 0.9 * (1 - out);

		// swarm → plate
		const fly_start =
			timeline.layer_start +
			v.layer * timeline.layer_step +
			(v.tile / per_layer) * 0.22;
		const fly_end = fly_start + timeline.layer_length - 0.22;
		const placed = ease_in_out(span(t, fly_start, fly_end));
		if (placed > 0) {
			const spread = stack_spread(t);
			const offset = (side - 1) / 2;
			const plate: Vec3 = [
				((v.tile % side) - offset) * spread,
				(2 - v.layer) * stack_gap(t),
				(Math.floor(v.tile / side) - offset) * spread,
			];
			pos = lerp3(pos, plate, placed);
			half = lerp3(half, [1.14, 0.27, 1.14], placed);
			rot_a *= 1 - placed;
			rot_b *= 1 - placed;
			const flash = t > fly_end ? Math.exp(-(t - fly_end) * 4.5) : 0;
			const charge = smooth(
				span(t, timeline.compress, timeline.burst),
			);
			color = lerp3(color, WHITE, 0.6 * flash);
			lit = lerp(lit, 0.62 + 0.38 * Math.max(flash, charge), placed);
		}

		// block → logo
		const burst_start =
			timeline.burst + v.grad_x * 0.42 + v.delay * 0.12;
		const burst_end = burst_start + 0.98;
		const built = ease_in_out(span(t, burst_start, burst_end));
		if (built > 0) {
			const arc = Math.sin(Math.PI * built);
			pos = lerp3(pos, v.logo, built);
			pos = [
				pos[0] + v.burst[0] * arc,
				pos[1] + v.burst[1] * arc,
				pos[2] + v.burst[2] * arc,
			];
			half = lerp3(half, [0.455, 0.79, 0.62], built);
			rot_a = v.tumble_a * (1 - ease_out(built));
			rot_b = v.tumble_b * arc;
			const landed =
				t > burst_end ? Math.exp(-(t - burst_end) * 6) : 0;
			color = lerp3(gradient_at(v.grad_x), WHITE, landed * 0.45);
			lit = 1;
		}
		return { pos, half, rot_a, rot_b, color, lit };
	}

	// State for the frame in progress.
	let ctx: CanvasRenderingContext2D;
	let layout = LAYOUTS.wide;
	let compact = false;
	const cam = {
		yaw_cos: 1,
		yaw_sin: 0,
		pitch_cos: 1,
		pitch_sin: 0,
		dist: 46,
		cx: 960,
		cy: 540,
	};

	function set_camera(t: number) {
		const mid_x = layout.width / 2;
		const mid_y = layout.height / 2;
		const [stack_x, stack_y, stack_dist] = layout.stack_cam;
		const orbit_start = timeline.layer_start + 0.5;
		// time, yaw, pitch, distance, centre x, centre y
		const keys = [
			[0, -0.14, 0.08, 42, mid_x, mid_y],
			[
				timeline.enter,
				0,
				CODE_CAMERA.pitch,
				CODE_CAMERA.dist,
				mid_x,
				mid_y,
			],
			[
				timeline.shatter,
				0,
				CODE_CAMERA.pitch,
				CODE_CAMERA.dist,
				mid_x,
				mid_y,
			],
			[timeline.shatter + 1.5, 0.5, 0.32, 56, mid_x, mid_y + 10],
			[orbit_start, 0.78, 0.47, stack_dist, stack_x, stack_y],
			[timeline.compress, 0.78, 0.47, stack_dist, stack_x, stack_y],
			[
				timeline.burst,
				0.78,
				0.3,
				layout.burst_dist,
				mid_x,
				mid_y + 20,
			],
			[
				timeline.land,
				-1.12,
				0.05,
				layout.logo_dist,
				mid_x,
				layout.logo_y,
			],
			[
				HERO_DURATION,
				-0.92,
				0.05,
				layout.logo_dist - 1.5,
				mid_x,
				layout.logo_y,
			],
		];
		let i = 0;
		while (i < keys.length - 2 && t >= keys[i + 1][0]) i++;
		const from = keys[i];
		const to = keys[i + 1];
		const raw = span(t, from[0], to[0]);
		const u =
			i === keys.length - 2
				? 1 - Math.pow(1 - raw, 2)
				: i === 6
					? ease_in_out(raw)
					: smooth(raw);
		const key = (j: number) => lerp(from[j], to[j], u);
		const x = clamp(t, orbit_start, timeline.burst) - orbit_start;
		const yaw = key(1) + 0.16 * (x < 1 ? (x * x) / 2 : x - 0.5);
		const sway = smooth(
			span(t, timeline.shatter, timeline.shatter + 1),
		);
		const pitch = key(2) + Math.sin(t * 0.8) * 0.012 * sway;
		const shake =
			t > timeline.burst
				? Math.exp(-(t - timeline.burst) * 7) * 9
				: 0;
		cam.yaw_cos = Math.cos(yaw);
		cam.yaw_sin = Math.sin(yaw);
		cam.pitch_cos = Math.cos(pitch);
		cam.pitch_sin = Math.sin(pitch);
		cam.dist = key(3);
		cam.cx = key(4) + Math.sin(t * 91) * shake;
		cam.cy = key(5) + Math.cos(t * 77) * shake;
	}

	function to_camera_dir(p: number[]): Vec3 {
		const x = p[0] * cam.yaw_cos - p[2] * cam.yaw_sin;
		const z = p[0] * cam.yaw_sin + p[2] * cam.yaw_cos;
		return [
			x,
			p[1] * cam.pitch_cos - z * cam.pitch_sin,
			p[1] * cam.pitch_sin + z * cam.pitch_cos,
		];
	}
	function to_camera(p: number[]): Vec3 {
		const q = to_camera_dir(p);
		q[2] += cam.dist;
		return q;
	}
	const project = (q: Vec3): Point => [
		cam.cx + (layout.focal * q[0]) / q[2],
		cam.cy + (layout.focal * q[1]) / q[2],
	];

	function code_metrics() {
		const size = layout.code_size;
		ctx.font = `600 ${size}px ${FONT}`;
		ctx.letterSpacing = '0px';
		const char_width = ctx.measureText('M').width;
		const line_height = size * 1.5;
		return {
			size,
			char_width,
			line_height,
			x: layout.width / 2 - (char_width * code_columns) / 2,
			y:
				layout.height / 2 -
				(line_height * (copy.code.length - 1)) / 2,
		};
	}

	// World position on the z = 0 plane that the code camera projects onto
	// the centre of a character. Cached for each layout.
	const code_positions = new Map<Layout, Vec3[][]>();
	function code_position(line: number, column: number): Vec3 {
		let lines = code_positions.get(layout);
		if (!lines) {
			const metrics = code_metrics();
			const cos = Math.cos(CODE_CAMERA.pitch);
			const sin = Math.sin(CODE_CAMERA.pitch);
			lines = copy.code.map((_, row) =>
				Array.from({ length: code_columns }, (_, col): Vec3 => {
					const dx =
						metrics.x +
						(col + 0.5) * metrics.char_width -
						layout.width / 2;
					const dy =
						metrics.y +
						row * metrics.line_height -
						metrics.size * 0.32 -
						layout.height / 2;
					const y =
						(dy * CODE_CAMERA.dist) / (layout.focal * cos - dy * sin);
					const depth = y * sin + CODE_CAMERA.dist;
					return [(dx * depth) / layout.focal, y, 0];
				}),
			);
			code_positions.set(layout, lines);
		}
		return lines[line][column];
	}

	function push_faces(state: VoxelState, faces: Face[]) {
		const { pos, half } = state;
		const ca = Math.cos(state.rot_a);
		const sa = Math.sin(state.rot_a);
		const cb = Math.cos(state.rot_b);
		const sb = Math.sin(state.rot_b);
		const axes = [
			[ca, 0, -sa],
			[sa * sb, cb, ca * sb],
			[sa * cb, -sb, ca * cb],
		];
		for (let d = 0; d < 3; d++) {
			for (const sign of [1, -1]) {
				const normal = axes[d].map((x) => x * sign);
				const centre = pos.map((x, k) => x + normal[k] * half[d]);
				const centre_cam = to_camera(centre);
				if (centre_cam[2] < 3) continue;
				const normal_cam = to_camera_dir(normal);
				const facing =
					normal_cam[0] * centre_cam[0] +
					normal_cam[1] * centre_cam[1] +
					normal_cam[2] * centre_cam[2];
				if (facing >= 0) continue;
				const u = axes[(d + 1) % 3];
				const w = axes[(d + 2) % 3];
				const half_u = half[(d + 1) % 3];
				const half_w = half[(d + 2) % 3];
				faces.push({
					depth: centre_cam[2],
					points: CORNERS.map(([i, j]) =>
						project(
							to_camera(
								centre.map(
									(x, k) => x + u[k] * half_u * i + w[k] * half_w * j,
								),
							),
						),
					),
					lambert: Math.max(
						0,
						normal[0] * LIGHT[0] +
							normal[1] * LIGHT[1] +
							normal[2] * LIGHT[2],
					),
					color: state.color,
					lit: state.lit,
				});
			}
		}
	}

	function trace(points: Point[]) {
		ctx.moveTo(points[0][0], points[0][1]);
		for (let k = 1; k < points.length; k++)
			ctx.lineTo(points[k][0], points[k][1]);
		ctx.closePath();
	}

	function draw_background(t: number) {
		const { width, height } = layout;
		ctx.fillStyle = rgba(BG);
		ctx.fillRect(0, 0, width, height);
		const pulse =
			0.5 + 0.5 * smooth(span(t, timeline.burst, timeline.land));
		for (const [x, y, color, alpha] of [
			[0.18, 0.1, MAGENTA, 0.13],
			[0.86, 0.92, BLUE, 0.09],
		] as const) {
			const glow = ctx.createRadialGradient(
				width * x,
				height * y,
				0,
				width * x,
				height * y,
				width * 0.56,
			);
			glow.addColorStop(0, rgba(color, alpha * pulse));
			glow.addColorStop(1, rgba(color, 0));
			ctx.fillStyle = glow;
			ctx.fillRect(0, 0, width, height);
		}
	}

	function floor_line(a: Vec3, b: Vec3) {
		const p = to_camera(a);
		const q = to_camera(b);
		if (p[2] < 3 || q[2] < 3) return;
		const from = project(p);
		const to = project(q);
		ctx.moveTo(from[0], from[1]);
		ctx.lineTo(to[0], to[1]);
	}

	function draw_floor(t: number) {
		const fade =
			smooth(span(t, 0.2, 1.6)) *
			lerp(
				1,
				0.5,
				smooth(span(t, timeline.burst + 0.6, timeline.land)),
			);
		const step = 4;
		const extent = 72;
		const piece = 6;
		ctx.lineWidth = 1.2;
		// One stroke for each distance band, so far lines are fainter.
		for (let band = 0; band < 4; band++) {
			const near = band * 18;
			ctx.beginPath();
			for (let i = -extent; i <= extent; i += step) {
				for (let j = -extent; j < extent; j += piece) {
					const distance = Math.hypot(i, j + piece / 2);
					if (distance < near || distance >= near + 18) continue;
					floor_line([i, FLOOR, j], [i, FLOOR, j + piece]);
					floor_line([j, FLOOR, i], [j + piece, FLOOR, i]);
				}
			}
			ctx.strokeStyle = rgba(
				lerp3(VIOLET, DIM, band / 3),
				fade * [0.5, 0.34, 0.2, 0.09][band],
			);
			ctx.stroke();
		}
		for (const ripple of ripples) {
			const age = t - ripple.start;
			if (age < 0 || age > 2.2) continue;
			const radius = age * ripple.speed;
			ctx.beginPath();
			let pen_down = false;
			for (let k = 0; k <= 72; k++) {
				const angle = (k / 72) * TAU;
				const q = to_camera([
					Math.cos(angle) * radius,
					FLOOR,
					Math.sin(angle) * radius,
				]);
				if (q[2] < 3) {
					pen_down = false;
					continue;
				}
				const p = project(q);
				if (pen_down) ctx.lineTo(p[0], p[1]);
				else ctx.moveTo(p[0], p[1]);
				pen_down = true;
			}
			ctx.lineWidth = 2.4;
			ctx.strokeStyle = rgba(
				ripple.color,
				ripple.gain * Math.pow(1 - age / 2.2, 2),
			);
			ctx.stroke();
		}
	}

	function draw_dust(t: number) {
		const fade = smooth(span(t, 0.3, 1.8));
		for (const mote of dust) {
			const q = to_camera([
				mote.pos[0],
				mote.pos[1] + Math.sin(t * 0.4 + mote.phase) * 1.5,
				mote.pos[2],
			]);
			if (q[2] < 6) continue;
			const p = project(q);
			const near = clamp(46 / q[2]);
			const size = (mote.size * 46) / q[2] + 0.6;
			ctx.fillStyle = rgba(
				MUTED,
				near *
					0.55 *
					fade *
					(0.6 + 0.4 * Math.sin(t * 1.3 + mote.phase)),
			);
			ctx.fillRect(p[0], p[1], size, size);
		}
	}

	// Offset outlines behind the logo, as the ╗║╝ shadow of the ASCII logo.
	function draw_echo(t: number) {
		const alpha = smooth(
			span(t, timeline.land - 0.25, timeline.land + 0.5),
		);
		if (alpha <= 0) return;
		for (const [k, offset] of [
			[1, 0.34],
			[2, 0.68],
		]) {
			const grown =
				offset *
				ease_out(
					span(
						t,
						timeline.land - 0.25 + k * 0.12,
						timeline.land + 0.45 + k * 0.12,
					),
				);
			for (const right_half of [false, true]) {
				ctx.beginPath();
				for (const v of voxels) {
					if (v.grad_x > 0.62 !== right_half) continue;
					const x = v.logo[0] + grown;
					const y = v.logo[1] + grown * 1.25;
					const z = 0.62 + offset * 1.6;
					trace(
						CORNERS.map(([i, j]) =>
							project(to_camera([x + i * 0.5, y + j * 0.85, z])),
						),
					);
				}
				ctx.lineWidth = 1.5;
				ctx.strokeStyle = rgba(
					right_half ? BLUE : MAGENTA,
					alpha * (k === 1 ? 0.8 : 0.45),
				);
				ctx.stroke();
			}
		}
	}

	// How far each logo cube is pushed toward the viewer: 0 to 1.
	const pushes = new Float32Array(count);
	const TAP_LIFE = 1.3;

	// Ease each cube toward the pointer and tap rings. Returns true while
	// a cube still moves, so the caller knows to draw one more frame.
	function update_pushes(t: number, interaction?: HeroInteraction) {
		const live = interaction && t >= HERO_DURATION;
		const reach = layout.width * 0.085;
		let moving = false;
		for (const v of voxels) {
			let target = 0;
			if (live) {
				const [x, y] = project(to_camera(v.logo));
				const { pointer, taps, clock } = interaction;
				if (pointer)
					target = smooth(
						1 - Math.hypot(x - pointer[0], y - pointer[1]) / reach,
					);
				for (const tap of taps) {
					const age = clock - tap.start;
					if (age < 0 || age > TAP_LIFE) continue;
					const ring = age * layout.width * 0.7;
					const band =
						1 -
						Math.abs(Math.hypot(x - tap.x, y - tap.y) - ring) / reach;
					target = Math.max(
						target,
						smooth(band) * (1 - age / TAP_LIFE),
					);
					moving = true;
				}
			}
			const push = pushes[v.index] + (target - pushes[v.index]) * 0.2;
			pushes[v.index] = Math.abs(push) < 0.003 && !target ? 0 : push;
			if (pushes[v.index] > 0) moving = true;
		}
		return moving;
	}

	function draw_voxels(t: number) {
		if (t < timeline.shatter) return;
		draw_echo(t);
		const faces: Face[] = [];
		for (const v of voxels) {
			const state = voxel_state(v, t);
			const push = pushes[v.index];
			if (push > 0) {
				state.pos = [
					state.pos[0],
					state.pos[1] - push * 0.5,
					state.pos[2] - push * 2.6,
				];
				state.color = lerp3(state.color, WHITE, push * 0.4);
			}
			push_faces(state, faces);
		}
		faces.sort((a, b) => b.depth - a.depth);
		ctx.lineJoin = 'round';
		ctx.lineWidth = 1.4;
		for (const face of faces) {
			ctx.beginPath();
			trace(face.points);
			// Three light steps only: flat 8-bit shading.
			const shade =
				(0.72 + (0.28 * Math.round(face.lambert * 3)) / 3) *
				(0.4 + 0.6 * face.lit);
			ctx.fillStyle = rgba(lerp3(BG, face.color, shade));
			ctx.fill();
			ctx.strokeStyle = rgba(
				lerp3(face.color, BG, 0.55 * face.lit),
				0.5 + 0.5 * face.lit,
			);
			ctx.stroke();
		}
	}

	function draw_text(
		text: string,
		x: number,
		y: number,
		size: number,
		color: Vec3,
		{
			weight = 500,
			align = 'left' as CanvasTextAlign,
			spacing = 0,
			alpha = 1,
		} = {},
	) {
		ctx.font = `${weight} ${size}px ${FONT}`;
		ctx.letterSpacing = `${spacing}px`;
		ctx.textAlign = align;
		ctx.fillStyle = rgba(color, alpha);
		ctx.fillText(text, x, y);
	}

	function wrap_text(
		text: string,
		size: number,
		weight: number,
		max_width: number,
	) {
		ctx.font = `${weight} ${size}px ${FONT}`;
		ctx.letterSpacing = '0px';
		const lines: string[] = [];
		let line = '';
		for (const word of text.split(' ')) {
			const next = line ? `${line} ${word}` : word;
			if (line && ctx.measureText(next).width > max_width) {
				lines.push(line);
				line = word;
			} else line = next;
		}
		lines.push(line);
		return lines;
	}

	function draw_prompt(t: number) {
		const gone = span(t, timeline.enter, timeline.enter + 0.16);
		if (gone >= 1) return;
		const prompt = `$ ${copy.prompt}`;
		const typed = Math.floor(
			clamp(
				(t - timeline.type_start) / timeline.char_step,
				0,
				prompt.length,
			),
		);
		const size = 54;
		const mid_x = layout.width / 2;
		const y = layout.height / 2 + 18;
		ctx.font = `600 ${size}px ${FONT}`;
		ctx.letterSpacing = '0px';
		const char_width = ctx.measureText('M').width;
		const x = mid_x - (char_width * prompt.length) / 2;
		const alpha = smooth(span(t, 0.25, 0.7)) * (1 - gone);
		const scale = 1 + gone * 0.12;
		ctx.save();
		ctx.translate(mid_x, y);
		ctx.scale(scale, scale);
		ctx.translate(-mid_x, -y);
		draw_text(
			prompt.slice(0, Math.min(typed, 1)),
			x,
			y,
			size,
			MAGENTA,
			{
				weight: 700,
				alpha,
			},
		);
		if (typed > 2)
			draw_text(
				prompt.slice(2, typed),
				x + char_width * 2,
				y,
				size,
				GREEN,
				{
					weight: 600,
					alpha,
				},
			);
		const blink =
			typed >= prompt.length &&
			Math.floor((t - timeline.type_start) * 2.6) % 2 === 1
				? 0.15
				: 1;
		ctx.fillStyle = rgba(TEXT, alpha * blink * 0.9);
		ctx.fillRect(
			x + char_width * Math.max(typed, 2) + 5,
			y - size * 0.78,
			char_width * 0.62,
			size * 0.98,
		);
		ctx.restore();
		draw_text(copy.comment, mid_x, y - 92, 22, MUTED, {
			align: 'center',
			alpha: alpha * smooth(span(t, 0.5, 1.1)),
			weight: 400,
		});
	}

	function draw_code(t: number) {
		const gone = span(t, timeline.shatter, timeline.shatter + 0.14);
		if (t < timeline.code_start || gone >= 1) return;
		const metrics = code_metrics();
		const alpha = 1 - gone;
		let budget = Math.ceil(
			code_length * span(t, timeline.code_start, timeline.code_end),
		);
		draw_text(
			copy.code_path,
			metrics.x,
			metrics.y - metrics.line_height * 1.3,
			metrics.size * 0.6,
			MUTED,
			{ weight: 400, alpha },
		);
		copy.code.forEach((tokens, line) => {
			let column = 0;
			for (const token of tokens) {
				if (budget <= 0) return;
				draw_text(
					token.text.slice(0, budget),
					metrics.x + column * metrics.char_width,
					metrics.y + line * metrics.line_height,
					metrics.size,
					token_color(token.type),
					{ weight: 600, alpha },
				);
				column += token.text.length;
				budget -= token.text.length;
			}
		});
	}

	function draw_callouts(t: number) {
		const off =
			1 -
			smooth(
				span(t, timeline.compress - 0.05, timeline.compress + 0.35),
			);
		if (t < timeline.layer_start - 0.1 || off <= 0) return;
		const mid_x = layout.width / 2;
		const rise = ease_out(
			span(t, timeline.layer_start - 0.1, timeline.layer_start + 0.6),
		);
		const headline_alpha =
			smooth(
				span(
					t,
					timeline.layer_start - 0.1,
					timeline.layer_start + 0.5,
				),
			) * off;
		wrap_text(
			copy.headline,
			44,
			650,
			layout.width - layout.margin * 3,
		).forEach((line, k) =>
			draw_text(
				line,
				compact ? mid_x : 112,
				layout.headline_y + k * 56 + (1 - rise) * 30,
				44,
				TEXT,
				{
					weight: 650,
					alpha: headline_alpha,
					spacing: -1.2,
					align: compact ? 'center' : 'left',
				},
			),
		);

		const edge = ((side - 1) / 2) * stack_spread(t) + 1.14;
		copy.stack.forEach(([name, body], k) => {
			const u = span(t, lock_at(k) - 0.12, lock_at(k) + 0.4);
			if (u <= 0) return;
			const shown = ease_out(u);
			const label_alpha = smooth(span(u, 0.25, 0.7)) * off;
			const typed_body = body.slice(
				0,
				Math.ceil(body.length * span(u, 0.3, 1)),
			);
			const index = `0${k + 1}`;
			if (compact) {
				// One label at a time below the stack.
				const next =
					k < copy.stack.length - 1
						? 1 -
							smooth(
								span(t, lock_at(k + 1) - 0.3, lock_at(k + 1) - 0.1),
							)
						: 1;
				const alpha = label_alpha * next;
				draw_text(index, mid_x, 800, 22, MAGENTA, {
					weight: 700,
					alpha,
					spacing: 2,
					align: 'center',
				});
				draw_text(name, mid_x, 858 + (1 - shown) * 12, 52, TEXT, {
					weight: 650,
					alpha,
					spacing: -0.8,
					align: 'center',
				});
				draw_text(typed_body, mid_x, 906, 28, MUTED, {
					weight: 450,
					alpha,
					align: 'center',
				});
				return;
			}
			const y = (2 - k) * stack_gap(t);
			let anchor: Point | null = null;
			for (const [i, j] of CORNERS) {
				const p = project(to_camera([edge * i, y, edge * j]));
				if (!anchor || p[0] > anchor[0]) anchor = p;
			}
			if (!anchor) return;
			const label_x = 1160;
			const label_y = 800 - k * 120;
			ctx.beginPath();
			ctx.moveTo(anchor[0] + 10, anchor[1]);
			ctx.lineTo(label_x - 96, label_y - 12);
			ctx.lineTo(label_x - 22, label_y - 12);
			const length =
				Math.hypot(
					label_x - 96 - anchor[0] - 10,
					label_y - 12 - anchor[1],
				) + 74;
			ctx.setLineDash([length * shown, length]);
			ctx.lineWidth = 1.6;
			ctx.strokeStyle = rgba(MAGENTA, 0.85 * off);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = rgba(MAGENTA, off);
			ctx.beginPath();
			ctx.arc(anchor[0] + 10, anchor[1], 4.5, 0, TAU);
			ctx.fill();
			draw_text(index, label_x, label_y - 34, 17, MAGENTA, {
				weight: 700,
				alpha: label_alpha,
				spacing: 2,
			});
			draw_text(
				name,
				label_x,
				label_y + 4 + (1 - shown) * 12,
				38,
				TEXT,
				{
					weight: 650,
					alpha: label_alpha,
					spacing: -0.8,
				},
			);
			draw_text(typed_body, label_x, label_y + 36, 21, MUTED, {
				weight: 450,
				alpha: label_alpha,
			});
		});

		const status_alpha =
			smooth(span(t, timeline.status, timeline.status + 0.4)) * off;
		if (status_alpha <= 0) return;
		const typed_status = copy.status.slice(
			0,
			Math.ceil(
				copy.status.length *
					span(t, timeline.status, timeline.status + 0.55),
			),
		);
		const status_size = compact ? 24 : 21;
		const status_y = compact ? 962 : 932;
		ctx.font = `500 ${status_size}px ${FONT}`;
		ctx.letterSpacing = '0px';
		const status_x = compact
			? mid_x - ctx.measureText(copy.status).width / 2 + 11
			: 142;
		ctx.fillStyle = rgba(GREEN, status_alpha);
		ctx.beginPath();
		ctx.arc(status_x - 22, status_y - 7, 6, 0, TAU);
		ctx.fill();
		draw_text(typed_status, status_x, status_y, status_size, MUTED, {
			alpha: status_alpha,
		});
	}

	function draw_lockup(t: number) {
		if (t < timeline.tagline) return;
		const mid_x = layout.width / 2;
		const typed = Math.ceil(
			copy.tagline.length *
				span(t, timeline.tagline, timeline.tagline + 0.75),
		);
		const tagline_size = compact ? 38 : 36;
		draw_text(
			copy.tagline.slice(0, typed),
			mid_x,
			layout.tagline_y,
			tagline_size,
			TEXT,
			{ align: 'center', spacing: -0.4 },
		);
		const u = span(t, timeline.command, timeline.command + 0.6);
		if (u <= 0) return;
		const shown = ease_out(u);
		const size = compact ? 34 : 28;
		ctx.font = `700 ${size}px ${FONT}`;
		ctx.letterSpacing = '0px';
		const char_width = ctx.measureText('M').width;
		const box_width = char_width * (copy.prompt.length + 2) + 64;
		const box_height = size * 2.4;
		const x = mid_x - box_width / 2;
		const y = layout.tagline_y + 56 + (1 - shown) * 26;
		const baseline = y + box_height / 2 + size * 0.34;
		ctx.globalAlpha = shown;
		ctx.beginPath();
		ctx.rect(x, y, box_width, box_height);
		ctx.fillStyle = rgba(BG, 0.92);
		ctx.fill();
		const length = 2 * (box_width + box_height);
		ctx.setLineDash([length * ease_in_out(u), length]);
		ctx.lineWidth = 1.6;
		ctx.strokeStyle = rgba(VIOLET);
		ctx.stroke();
		ctx.setLineDash([]);
		draw_text('$', x + 32, baseline, size, MAGENTA, { weight: 800 });
		draw_text(
			copy.prompt,
			x + 32 + char_width * 2,
			baseline,
			size,
			GREEN,
			{ weight: 700 },
		);
		ctx.globalAlpha = 1;
	}

	function draw_frame(t: number) {
		const { width, height, margin } = layout;
		const alpha = smooth(span(t, 0.15, 0.9));
		const inset = margin - 32;
		ctx.strokeStyle = rgba(DIM, alpha);
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (const [x, y, dx, dy] of [
			[inset, inset, 1, 1],
			[width - inset, inset, -1, 1],
			[inset, height - inset, 1, -1],
			[width - inset, height - inset, -1, -1],
		]) {
			ctx.moveTo(x + dx * 22, y);
			ctx.lineTo(x, y);
			ctx.lineTo(x, y + dy * 22);
		}
		ctx.stroke();
	}

	function draw(
		context: CanvasRenderingContext2D,
		time: number,
		is_compact: boolean,
		interaction?: HeroInteraction,
	) {
		ctx = context;
		compact = is_compact;
		layout = compact ? LAYOUTS.compact : LAYOUTS.wide;
		const t = clamp(time, 0, HERO_DURATION);
		const { width, height } = layout;
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		set_camera(t);
		const moving = update_pushes(t, interaction);
		draw_background(t);
		draw_floor(t);
		draw_dust(t);
		draw_voxels(t);
		for (const [start, color, gain] of [
			[timeline.shatter, MAGENTA, 0.16],
			[timeline.burst, WHITE, 0.3],
		] as const) {
			if (t < start) continue;
			ctx.globalCompositeOperation = 'lighter';
			ctx.fillStyle = rgba(color, gain * Math.exp(-(t - start) * 8));
			ctx.fillRect(0, 0, width, height);
			ctx.globalCompositeOperation = 'source-over';
		}
		const vignette = ctx.createRadialGradient(
			width / 2,
			height / 2,
			width * 0.2,
			width / 2,
			height / 2,
			width * 0.62,
		);
		vignette.addColorStop(0, 'rgba(0,0,0,0)');
		vignette.addColorStop(1, 'rgba(0,0,0,.45)');
		ctx.fillStyle = vignette;
		ctx.fillRect(0, 0, width, height);
		draw_prompt(t);
		draw_code(t);
		draw_callouts(t);
		draw_lockup(t);
		draw_frame(t);
		const fade_in = 1 - smooth(span(t, 0, 0.45));
		if (fade_in > 0) {
			ctx.fillStyle = `rgba(0,0,0,${fade_in})`;
			ctx.fillRect(0, 0, width, height);
		}
		return moving;
	}

	return {
		draw,
		size: (is_compact: boolean) =>
			is_compact ? LAYOUTS.compact : LAYOUTS.wide,
	};
}
