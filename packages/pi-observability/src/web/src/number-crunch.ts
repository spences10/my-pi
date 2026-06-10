export const number_crunch = (num: number | string): string => {
	if (!num || num === '' || num === '0') return '0';

	const suffixes = ['', 'k', 'm', 'b', 't'];
	const num_value = Number(num);
	const num_absolute = Math.abs(num_value);
	const sign = Math.sign(num_value);

	if (Number.isNaN(num_absolute)) return '0';

	const magnitude = Math.min(
		Math.floor(Math.log10(num_absolute) / 3),
		suffixes.length - 1,
	);

	if (magnitude === 0 && num_absolute < 1) return '0';

	const abbreviation = (
		num_absolute / Math.pow(10, magnitude * 3)
	).toFixed(magnitude === 0 ? 0 : 1);
	const abbreviation_without_trailing_zero = abbreviation.endsWith(
		'.0',
	)
		? abbreviation.slice(0, -2)
		: abbreviation;

	return `${sign < 0 ? '-' : ''}${abbreviation_without_trailing_zero}${suffixes[magnitude]}`;
};
