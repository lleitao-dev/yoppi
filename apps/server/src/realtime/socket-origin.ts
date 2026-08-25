export function isAllowedSocketRequest(
  origin: string | undefined,
  host: string | undefined,
  webOrigin: string,
): boolean {
  if (origin !== undefined) return origin === webOrigin;
  if (host === undefined) return false;

  const expectedHost = new URL(webOrigin).host;
  return host.toLowerCase() === expectedHost.toLowerCase();
}
