export function authenticated_dashboard_url(
	url: string,
	token: string | undefined,
): string {
	if (!token) return url;
	const dashboard_url = new URL(url);
	dashboard_url.hash = new URLSearchParams({ token }).toString();
	return dashboard_url.toString();
}
