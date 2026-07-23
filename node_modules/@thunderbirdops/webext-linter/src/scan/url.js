// Classifies a URL/reference string found in HTML/CSS/JS so the remote-code
// check can decide whether a referenced source is bundled (local) or fetched
// from the network (remote).
//
// Belongs here: pure remote/embedded/local classification of a URL or reference
// string by its scheme/shape. Shared by every scanner that finds URLs.
//
// Does NOT belong here: finding the URLs in the first place - that is the
// per-format scanners (src/scan/css.js, src/scan/html.js, src/scan/csp.js).
// Deciding whether a remote reference is a violation lives in the checks
// (src/checks/rules/*) and the registry (assets/registry.yaml).

import { URL_CLASS } from "../lib/enum.js";

const REMOTE_RE = /^(?:https?:|ftps?:|wss?:)\/\//i;
const PROTOCOL_RELATIVE_RE = /^\/\//; // "//host/x" - inherits page scheme, i.e. remote
const EMBEDDED_RE = /^(?:data|blob):/i;

/**
 * @param {string} raw  URL or reference string to classify.
 * @returns {import("../lib/enum.js").UrlClass}
 *   - REMOTE:   network-loaded (http/https/ftp/ws, or protocol-relative
 *               "//host")
 *   - EMBEDDED: inline payload (data:, blob:) - not bundled source, often
 *               obfuscation
 *   - LOCAL:    relative path, root-relative "/x",
 *               moz-extension:/chrome:/resource:, "#...", or empty
 */
export function classifyUrl(raw) {
  const url = String(raw ?? "").trim();
  if (url === "") {
    return URL_CLASS.LOCAL;
  }
  if (EMBEDDED_RE.test(url)) {
    return URL_CLASS.EMBEDDED;
  }
  if (REMOTE_RE.test(url) || PROTOCOL_RELATIVE_RE.test(url)) {
    return URL_CLASS.REMOTE;
  }
  return URL_CLASS.LOCAL;
}

/**
 * True when a URL authority is a loopback address - traffic that never leaves the
 * machine (cannot be sniffed in transit and cannot hold a CA certificate), so the
 * "remote transmission" judgments (cleartext / privacy-policy) do not apply.
 * Matches `localhost` (and `*.localhost`), IPv4 127.0.0.0/8, 0.0.0.0, and IPv6
 * ::1 - true loopback only. Private LAN (RFC-1918) is deliberately NOT loopback:
 * that traffic does traverse a network.
 *
 * Used to downgrade a loopback outbound sink to "local" in
 * src/parse/network-sinks.js. classifyUrl itself is left scheme-only, so a
 * loopback <script src> still classifies remote for the remote-code checks (it is
 * still unbundled, unreviewable code).
 * @param {?string} authority  host, host:port, or user@host:port (or null).
 * @returns {boolean}
 */
export function isLoopback(authority) {
  if (!authority) {
    return false;
  }
  let host = String(authority);
  const at = host.lastIndexOf("@");
  if (at !== -1) {
    host = host.slice(at + 1); // drop any userinfo
  }
  if (host.startsWith("[")) {
    const end = host.indexOf("]"); // [::1]:port -> ::1
    host = end !== -1 ? host.slice(1, end) : host.slice(1);
  } else if (
    host.includes(":") &&
    host.indexOf(":") === host.lastIndexOf(":")
  ) {
    host = host.slice(0, host.indexOf(":")); // host:port -> host (not IPv6)
  }
  host = host.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host === "0.0.0.0" ||
    // 127.0.0.0/8 incl. the shorthand forms (127.1, 127.0.1); all-numeric only,
    // so a hostname like "127.example.com" is not mistaken for loopback.
    /^127(?:\.\d{1,3}){1,3}$/.test(host)
  );
}
