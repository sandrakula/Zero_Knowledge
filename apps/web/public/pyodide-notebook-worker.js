/* Browser-side Python runtime for notebook cells with scientific packages.
 * Runs in a dedicated Worker so loading numpy/pandas/sklearn never blocks the
 * page. One Pyodide instance is kept for the lifetime of the worker, so
 * imports and variables survive between cell runs.
 */
let pyodidePromise = null

const PYODIDE_VERSION = '0.27.3'
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

async function getPyodide() {
  if (pyodidePromise) return pyodidePromise
  pyodidePromise = (async () => {
    importScripts(`${PYODIDE_BASE}pyodide.js`)
    return await self.loadPyodide({ indexURL: PYODIDE_BASE })
  })()
  return pyodidePromise
}

self.onmessage = async (event) => {
  const { id, code, importsCode } = event.data || {}
  if (!id) return

  try {
    const pyodide = await getPyodide()

    if (importsCode) {
      self.postMessage({ id, type: 'status', message: 'Loading scientific packages…' })
      try {
        await pyodide.loadPackagesFromImports(importsCode, {
          messageCallback: (message) => {
            self.postMessage({ id, type: 'status', message })
          },
        })
      } catch {
        // Let execution report the concrete missing import.
      }

      // Pyodide does not bundle seaborn. The cell often imports it without
      // using it; execution installs a clear stub below, while unsupported
      // calls fail with a readable message instead of breaking the import.
    }

    self.postMessage({ id, type: 'status', message: 'Running…' })
    const raw = await pyodide.runPythonAsync(code)
    const result = JSON.parse(String(raw))
    self.postMessage({ id, type: 'result', result })
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
