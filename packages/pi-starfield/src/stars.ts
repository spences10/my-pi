const DOTS = ['⠁', '⠂', '⠄', '⠈', '⠐', '⠠', '⡀', '⢀'];

export interface Star {
	x: number;
	y: number;
	glyph: string;
	brightness: number;
}

function cell_hash(x: number, y: number): number {
	let value =
		Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
	value = Math.imul(value ^ (value >>> 13), 1274126177);
	return (value ^ (value >>> 16)) >>> 0;
}

// Coordinates stay fixed across frames and resizes; only brightness changes.
export function star_frame(
	width: number,
	elapsed_ms: number,
): Star[] {
	const stars: Star[] = [];
	for (let y = 0; y < 3; y++) {
		for (let x = 0; x < width; x++) {
			const hash = cell_hash(x, y);
			if (hash % 6 !== 0) continue;
			const period = 9000 + (hash % 5000);
			const phase = (hash % 1000) / 1000;
			const wave =
				(1 + Math.cos(2 * Math.PI * (elapsed_ms / period + phase))) /
				2;
			const brightness = 0.28 * wave ** 3;
			if (brightness < 0.02) continue;
			stars.push({
				x,
				y,
				glyph: DOTS[(hash >>> 8) % DOTS.length]!,
				brightness,
			});
		}
	}
	return stars;
}

type RGB = [number, number, number];

function ansi_rgb(ansi: string): RGB | undefined {
	if (!ansi.startsWith('\x1b[')) return undefined;
	const match = /^(?:38|48);2;(\d+);(\d+);(\d+)m$/.exec(
		ansi.slice(2),
	);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function star_color(
	foreground: string,
	background: string,
	brightness: number,
): string | undefined {
	const fg = ansi_rgb(foreground);
	const bg = ansi_rgb(background);
	if (!fg || !bg) return undefined;
	const rgb = bg.map((channel, index) =>
		Math.round(channel + (fg[index]! - channel) * brightness),
	);
	return `\x1b[38;2;${rgb.join(';')}m`;
}
