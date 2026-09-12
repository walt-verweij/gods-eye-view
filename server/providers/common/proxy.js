/**
 * Makes a proxy's dev/preview availability an explicit plugin contract.
 * Data feeds are available in both servers by default; credential setup opts
 * out because preview must never expose configuration writes.
 *
 * @param {import('vite').Plugin} plugin
 * @param {{preview?: boolean}} [options]
 * @returns {import('vite').Plugin}
 */
export function registerProxy(plugin, { preview = true } = {}) {
  const handler = plugin.configureServer;
  if (typeof handler !== 'function') throw new TypeError(`${plugin.name} requires configureServer`);
  return {
    ...plugin,
    configureServer: handler,
    ...(preview ? { configurePreviewServer: handler } : {}),
  };
}
