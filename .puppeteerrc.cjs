const { join } = require("path");

/**
 * Su Render (env RENDER=true) la cache di default (~/.cache/puppeteer) del
 * build NON esiste a runtime: puntiamo la cache DENTRO il progetto, che viene
 * copiato nel filesystem di runtime. In locale restano i default (~/.cache).
 * Letto sia dal download di Chrome (postinstall) sia dal launch a runtime.
 */
module.exports = process.env.RENDER
  ? { cacheDirectory: join(__dirname, ".cache", "puppeteer") }
  : {};
