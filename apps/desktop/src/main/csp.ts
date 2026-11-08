/** The page runs only its own code, and loads video and frame data only from the clip library. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // blob: is only the video the user has just picked, read by the page itself.
  "media-src rowvision: blob:",
  "connect-src rowvision:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join("; ");
