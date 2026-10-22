'use client'

/**
 * Browser-side Python runtime for notebook cells that need scientific
 * packages Judge0's stock Python image does not ship (numpy, pandas,
 * scikit-learn, matplotlib, ...). Pyodide runs inside a Worker, so loading a
 * large scientific stack never freezes the editor, and one worker keeps a
 * single global namespace across cells.
 */

export type BrowserNotebookResult = {
  stdout: string
  stderr: string
  compile_output?: string | null
  status?: { id: number; description: string } | null
  time?: string | null
  image?: string | null
}

type PendingRequest = {
  resolve: (_result: BrowserNotebookResult) => void
  reject: (_error: Error) => void
  onStatus?: (_message: string) => void
}

let worker: Worker | null = null
let nextRequestId = 1
const pending = new Map<number, PendingRequest>()

function ensureWorker(): Worker {
  if (worker) return worker

  worker = new Worker('/pyodide-notebook-worker.js')
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data || {}
    const request = pending.get(data.id)
    if (!request) return

    if (data.type === 'status') {
      request.onStatus?.(String(data.message || ''))
      return
    }

    pending.delete(data.id)
    if (data.type === 'result') {
      const result = data.result || {}
      request.resolve({
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
        compile_output: null,
        // The worker only sends `result` when runPythonAsync returned; stderr
        // here is warnings (e.g. matplotlib font cache), not a failure.
        status: { id: 3, description: 'Accepted (browser)' },
        image: result.image ? `data:image/png;base64,${result.image}` : null,
      })
    } else {
      request.reject(new Error(String(data.message || 'Browser Python runtime failed')))
    }
  }

  worker.onerror = () => {
    for (const request of pending.values()) {
      request.reject(new Error('Browser Python runtime crashed'))
    }
    pending.clear()
    worker?.terminate()
    worker = null
  }

  return worker
}

function toBase64(source: string): string {
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function buildCode(previousSources: string[], currentSource: string): string {
  const previousLiterals = previousSources.map((source) => `'${toBase64(source)}'`).join(', ')
  const currentLiteral = toBase64(currentSource)
  return `
import base64 as _nb_b64, contextlib as _nb_ctx, io as _nb_io, json as _nb_json
try:
    import seaborn as _nb_seaborn
except Exception:
    import types as _nb_types, sys as _nb_sys
    _nb_seaborn = _nb_types.ModuleType('seaborn')
    def _nb_missing_seaborn(*_args, **_kwargs):
        raise RuntimeError('seaborn is not available in the browser runtime; use matplotlib instead')
    _nb_seaborn.__getattr__ = lambda _name: _nb_missing_seaborn
    _nb_sys.modules['seaborn'] = _nb_seaborn
_nb_globals = globals()
_nb_prev_out = _nb_io.StringIO()
_nb_prev_err = _nb_io.StringIO()
for _nb_src in [${previousLiterals}]:
    with _nb_ctx.redirect_stdout(_nb_prev_out), _nb_ctx.redirect_stderr(_nb_prev_err):
        exec(compile(_nb_b64.b64decode(_nb_src).decode('utf-8'), '<cell>', 'exec'), _nb_globals)
_nb_out = _nb_io.StringIO()
_nb_err = _nb_io.StringIO()
_nb_image = None
with _nb_ctx.redirect_stdout(_nb_out), _nb_ctx.redirect_stderr(_nb_err):
    exec(compile(_nb_b64.b64decode('${currentLiteral}').decode('utf-8'), '<current-cell>', 'exec'), _nb_globals)
try:
    import matplotlib.pyplot as _nb_plt
    if _nb_plt.get_fignums():
        _nb_buf = _nb_io.BytesIO()
        _nb_plt.savefig(_nb_buf, format='png', bbox_inches='tight')
        _nb_image = _nb_b64.b64encode(_nb_buf.getvalue()).decode('ascii')
        _nb_plt.close('all')
except Exception:
    pass
_nb_json.dumps({'stdout': _nb_out.getvalue(), 'stderr': _nb_err.getvalue(), 'image': _nb_image})
`
}

/**
 * Execute the current cell after replaying earlier code cells in one persistent
 * worker namespace. Earlier output is suppressed; the last matplotlib figure
 * is returned as a data URL.
 */
export async function runNotebookCellInBrowser(
  previousSources: string[],
  currentSource: string,
  onStatus?: (_message: string) => void
): Promise<BrowserNotebookResult> {
  const activeWorker = ensureWorker()
  const id = nextRequestId++

  return await new Promise<BrowserNotebookResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(id)
      activeWorker.terminate()
      worker = null
      reject(new Error('Browser Python runtime timed out'))
    }, 240_000)

    pending.set(id, {
      resolve: (result) => {
        window.clearTimeout(timeout)
        resolve(result)
      },
      reject: (error) => {
        window.clearTimeout(timeout)
        reject(error)
      },
      onStatus,
    })

    activeWorker.postMessage({
      id,
      code: buildCode(previousSources, currentSource),
      importsCode: [...previousSources, currentSource].join('\n'),
    })
  })
}

export function isMissingPythonModule(result: {
  stderr?: string | null
  compile_output?: string | null
}): boolean {
  const text = `${result.stderr || ''}\n${result.compile_output || ''}`
  return /ModuleNotFoundError|No module named|ImportError/i.test(text)
}
