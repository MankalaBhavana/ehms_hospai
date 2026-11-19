import React from "react"

/**
 * Contains a crash to the page that threw it.
 *
 * Without this, one screen choking on an unexpected API payload unmounted the
 * whole app -- header, sidebar and all -- leaving a blank window with no way to
 * navigate elsewhere. `resetKey` is the current module, so moving to another
 * page clears the error.
 */
export default class PageErrorBoundary extends React.Component<
  { resetKey: string; children: React.ReactNode },
  { error: Error | null; info: React.ErrorInfo | null }
> {
  state: { error: Error | null; info: React.ErrorInfo | null } = {
    error: null,
    info: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error, info: null }
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null })
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[PageErrorBoundary]", error, info.componentStack)
    // A lazy chunk that no longer exists means a newer version was deployed: reload.
    if (PageErrorBoundary.isStaleVersionError(error)) {
      ;(window as any).__hospaiReloadForNewVersion?.()
    }
    this.setState({ info })
  }

  static isStaleVersionError(error: Error | null): boolean {
    return /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch dynamically/i.test(
      String(error?.message || ""),
    )
  }

  render() {
    if (!this.state.error) return this.props.children

    if (PageErrorBoundary.isStaleVersionError(this.state.error)) {
      return (
        <div className="flex-1 flex items-start justify-center p-4 sm:p-8">
          <div className="w-full max-w-md bg-white border border-[#BFDBFE] rounded-lg p-5 text-[13px] text-[#334155] shadow-sm">
            <div className="text-[15px] font-bold text-[#1D4ED8] mb-1">The application was updated</div>
            <p className="mb-3 text-[#64748B]">Loading the latest version of this page...</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-8 px-3 bg-[#1B4FD8] hover:bg-blue-700 text-white text-[12px] font-semibold rounded"
            >
              Reload now
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex-1 flex items-start justify-center p-4 sm:p-8">
        <div className="w-full max-w-xl bg-white border border-[#FECACA] rounded-lg p-5 text-[13px] text-[#334155] shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[15px] font-bold text-[#B91C1C]">
              This page could not be displayed
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
              Module: {this.props.resetKey}
            </span>
          </div>
          <p className="mb-3 text-[#64748B]">
            It received data it did not expect -- often because a backend
            service is not running. Other pages are unaffected.
          </p>
          <pre className="bg-[#F8FAFC] border border-[#E2E8F0] p-2.5 text-[11.5px] whitespace-pre-wrap break-words text-[#475569] mb-3 max-h-56 overflow-auto font-mono">
            {this.state.error.message}
            {this.state.error.stack && (
              <div className="mt-2 pt-2 border-t border-slate-200 text-[10.5px] text-slate-500">
                {this.state.error.stack}
              </div>
            )}
            {this.state.info?.componentStack && (
              <div className="mt-2 pt-2 border-t border-slate-200 text-[10.5px] text-slate-500">
                {this.state.info.componentStack}
              </div>
            )}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null, info: null })}
            className="h-8 px-3 bg-[#1B4FD8] hover:bg-blue-700 text-white text-[12px] font-semibold rounded"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
