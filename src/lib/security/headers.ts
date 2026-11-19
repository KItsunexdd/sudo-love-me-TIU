// Next embeds hydration scripts in HTML. Each page response authorizes its own scripts.
export function contentSecurityPolicy(nonce?: string, target?: URL) {
  const dev = process.env.NODE_ENV === "development";
  const socket = dev && target ? (target.protocol === "https:" ? "wss://" : "ws://") + target.host : undefined;
  return [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ["script-src 'self'", nonce && `'nonce-${nonce}'`, dev && "'unsafe-eval'"].filter(Boolean).join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    ["connect-src 'self'", socket].filter(Boolean).join(" "),
  ].join("; ");
}
