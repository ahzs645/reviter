// Local macOS runs use the patched system Chrome with its sandbox on.
// Other platforms keep whichever browser Playwright finds.
export const macChrome =
  process.platform === "darwin" ? { channel: "chrome", chromiumSandbox: true } : {};
