'use client'
/**
 * Thin React adapter around @simonwep/pickr for the pattern-color swatches.
 * Pickr is an imperative DOM widget: the instance lives in a ref, the JS is
 * dynamic-imported so it splits out of the editor's first chunk, and the theme
 * CSS stays with the importing component.
 */
import { useEffect, useRef } from 'react'
import type Pickr from '@simonwep/pickr'

export interface PickrCallbacks {
  /** Live drag update: only the local pending swatch changes. */
  onChange: (hex: string) => void
  /** save / changestop: attempt to commit through the settings pipeline. */
  onCommit: (hex: string) => void
  /** Cancel button: revert the row's pending color to committed. */
  onCancel: () => void
  /** Popover hidden: revert any uncommitted pending color to committed. */
  onRevert: () => void
}

export interface UsePickrOptions {
  /** A real <button>; pickr toggles the popover from it (useAsButton). */
  buttonRef: React.RefObject<HTMLElement | null>
  /** Popover parent: defaults to the ancestor <dialog>, which keeps it above the modal backdrop. */
  containerRef?: React.RefObject<HTMLElement | null>
  color: string
  callbacks: PickrCallbacks
}

export function usePickr({ buttonRef, containerRef, color, callbacks }: UsePickrOptions): void {
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })
  const instanceRef = useRef<Pickr | null>(null)

  // Create and destroy once per mount; pickr rebuilds when the panel remounts.
  useEffect(() => {
    let disposed = false
    const button = buttonRef.current
    if (!button) return () => undefined

    let instance: Pickr | null = null
    const guard = (event: KeyboardEvent) => {
      // With a popover open, Escape must close only the popover: pickr hides on document
      // keyup, and swallowing the keydown stops the <dialog>'s cancel/closedby dismiss.
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const created = import('@simonwep/pickr').then(({ default: Pickr }) => {
      if (disposed) return
      instance = Pickr.create({
        el: button,
        container: containerRef?.current ?? button.closest('dialog') ?? document.body,
        theme: 'monolith',
        useAsButton: true,
        lockOpacity: true,
        closeOnScroll: true,
        closeWithKey: 'Escape',
        position: 'bottom-middle',
        comparison: true,
        swatches: ['#101211', '#ff321e', '#ffffff', '#c22312'],
        components: {
          preview: true,
          opacity: false,
          hue: true,
          interaction: { hex: true, input: true, save: true, cancel: true },
        },
      })
        .on('change', (picked: Pickr.HSVaColor) => {
          const hex = hexOf(picked)
          if (hex) callbacksRef.current.onChange(hex)
        })
        .on('save', (picked: Pickr.HSVaColor | null) => {
          const hex = hexOf(picked)
          if (hex) callbacksRef.current.onCommit(hex)
        })
        .on('changestop', (_source: string, pickerInstance: Pickr) => {
          // pickr emits the instance here, not a color; read the live color from it.
          const hex = hexOf(pickerInstance?.getColor?.())
          if (hex) callbacksRef.current.onCommit(hex)
        })
        .on('cancel', () => callbacksRef.current.onCancel())
        .on('hide', () => {
          document.removeEventListener('keydown', guard, true)
          callbacksRef.current.onRevert()
        })
        .on('show', () => document.addEventListener('keydown', guard, true))
      instanceRef.current = instance
      return instance
    })

    return () => {
      disposed = true
      document.removeEventListener('keydown', guard, true)
      instanceRef.current = null
      // Destroy once the pending create resolves; destroying mid-creation is allowed too.
      created.then((createdInstance) => createdInstance?.destroyAndRemove()).catch(() => {})
    }
  }, [buttonRef, containerRef])

  // Track external committed values; never rewrite a popover the user is interacting with.
  useEffect(() => {
    const instance = instanceRef.current
    if (!instance || instance.getColor().toHEXA().toString().toLowerCase() === color) return
    instance.setColor(color, true)
  }, [color])
}

function hexOf(picked: Pickr.HSVaColor | null | undefined): string | null {
  const hex = (picked as Pickr.HSVaColor | undefined)?.toHEXA?.().toString().toLowerCase() ?? null
  return hex && /^#[0-9a-f]{6}$/.test(hex) ? hex : null
}
