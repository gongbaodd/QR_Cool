'use client'
import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const BREAKPOINT = 900
const styles = stylex.create({
  dialog: {
    margin: 0,
    padding: 18,
    minWidth: 0,
    color: tokens.ink,
    backgroundColor: tokens.paper,
    border: 'none',
    borderWidth: 0,
    borderStyle: 'none',
    outline: 'none',
    '@media (min-width: 901px)': {
      position: 'static',
      width: 'auto',
      height: '100%',
      overflow: 'auto',
      padding: 0,
      backgroundColor: 'transparent',
    },
    '@media (max-width: 900px)': {
      position: 'fixed',
      insetBlock: 0,
      width: 'min(24rem, calc(100dvw - 2rem))',
      maxWidth: 'calc(100dvw - 2rem)',
      maxHeight: '100svh',
      overflowY: 'auto',
      boxShadow: tokens.shadowLg,
      transitionProperty: 'transform',
      transitionDuration: '180ms',
      transitionTimingFunction: 'ease-out',
    },
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0ms' },
    '::backdrop': { backgroundColor: 'rgba(35, 39, 43, 0.45)' },
  },
  left: { '@media (max-width: 900px)': { insetInlineStart: 0, transform: 'translateX(-105%)' } },
  right: { '@media (max-width: 900px)': { insetInlineEnd: 0, transform: 'translateX(105%)' } },
  openLeft: { '@media (max-width: 900px)': { transform: 'translateX(0)' } },
  close: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
})

export default function ResponsiveEditorPanel({
  id,
  side,
  title,
  open,
  onOpenChange,
  triggerRef,
  children,
}: {
  id: string
  side: 'left' | 'right'
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  children: React.ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${BREAKPOINT}px)`)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (mobile) {
      if (dialog.open) dialog.close()
      if (open) {
        dialog.showModal()
        requestAnimationFrame(() => headingRef.current?.focus())
      }
    } else if (!dialog.open) {
      dialog.show()
    }
  }, [mobile, open])
  useEffect(() => {
    if (!mobile) return
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [mobile, open])
  function close() {
    onOpenChange(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
  return (
    <dialog
      ref={dialogRef}
      id={id}
      {...stylex.props(styles.dialog, side === 'left' ? styles.left : styles.right, open && styles.openLeft)}
      aria-labelledby={`${id}-title`}
      closedby="any"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClose={() => {
        if (mobile && open) onOpenChange(false)
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close()
      }}
    >
      <div {...stylex.props(styles.close)}>
        <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} {...stylex.props(ui.sectionHeading)}>
          {title}
        </h2>
        <button {...stylex.props(ui.button, ui.textButton)} type="button" onClick={close}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  )
}
