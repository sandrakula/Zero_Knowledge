'use client'
import React from 'react'
import { Loader2 } from 'lucide-react'

function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 flex flex-col items-center justify-center select-none"
      style={{
        zIndex: 9999,
        backgroundColor: 'var(--t-bg, #ffffff)',
        color: 'var(--t-text, #0a0a0c)',
      }}
    >
      <div className="animate-page-loading-in flex flex-col items-center gap-4">
        <div
          className="relative flex h-14 w-14 items-center justify-center rounded-2xl border shadow-lg"
          style={{
            backgroundColor: 'var(--t-surface, #ffffff)',
            borderColor: 'var(--t-border, #e5e7eb)',
          }}
        >
          <img
            src="/zerok-icon.png"
            alt="zerok"
            className="h-8 w-8 object-contain"
          />
          <span
            className="absolute -bottom-1 -end-1 flex h-5 w-5 items-center justify-center rounded-full shadow-xs"
            style={{
              backgroundColor: 'var(--t-accent, #c6ff4a)',
              color: 'var(--t-accent-ink, #0a0a0a)',
            }}
          >
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.75} />
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-tight">
            zerok
          </span>
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: 'var(--t-accent, #c6ff4a)' }}
          />
        </div>
      </div>
    </div>
  )
}

export default PageLoading
