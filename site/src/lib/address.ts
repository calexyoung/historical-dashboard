/**
 * The site's own address as a reader would write it, for a citation or a file. Pure.
 *
 * It is built from the Host the reader named, which the reader controls: it must look like a
 * host and nothing else, and one that does not gives an address with no host in it. Plain http
 * is only ever written for this machine's own names.
 */
const HOST = /^([a-z0-9.-]{1,253}|\[[0-9a-f:]{2,45}\])(:[0-9]{1,5})?$/i;
const LOOPBACK = /^(localhost|[a-z0-9-]+\.localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$/i;

export function siteAddress(host: string | null, forwardedProto: string | null, basePath: string): string {
  if (!host || !HOST.test(host)) return basePath;
  const proto = LOOPBACK.test(host) ? (forwardedProto === "https" ? "https" : "http") : "https";
  return `${proto}://${host.toLowerCase()}${basePath}`;
}
