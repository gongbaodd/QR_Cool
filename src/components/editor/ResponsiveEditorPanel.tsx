'use client'
import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { motion, useReducedMotion } from 'motion/react'
import { MOBILE_LAYOUT_QUERY } from '@/lib/editor/responsive'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

// Keep this query aligned with the CSS mobile-panel breakpoint below (900px at a 16px default).
export { MOBILE_LAYOUT_QUERY } from '@/lib/editor/responsive'
const styles = stylex.create({
  dialog: {
    margin: 0,
    padding: 0,
    minWidth: 0,
    color: tokens.ink,
    backgroundColor: 'transparent',
    border: 'none',
    borderWidth: 0,
    borderStyle: 'none',
    outline: 'none',
    '@media (min-width: 56.3125em)': {
      position: 'static',
      width: 'auto',
      height: '100%',
      overflow: 'visible',
      backgroundColor: 'transparent',
    },
    '@media (max-width: 56.25em)': {
      position: 'fixed',
      inset: 0,
      width: '100vw',
      height: '100svh',
      maxWidth: 'none',
      maxHeight: 'none',
      overflow: 'hidden',
    },
    '::backdrop': { backgroundColor: 'rgba(16, 18, 17, 0.45)' },
  },
  surface: {
    width: '100%',
    height: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding:
      'max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left))',
    backgroundColor: tokens.paper,
    '@media (min-width: 56.3125em)': {
      height: '100%',
      overflow: 'visible',
      padding: 0,
      backgroundColor: 'transparent',
    },
  },
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
  children:
    | React.ReactNode
    | ((controls: {
        close: () => void
        closeButtonRef: React.RefObject<HTMLButtonElement | null>
        isDialog: boolean
      }) => React.ReactNode)
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const previousMobile = useRef<boolean | null>(null)
  const latestOpen = useRef(open)
  const focusFrame = useRef<number | null>(null)
  const revealFrame = useRef<number | null>(null)
  const slideOpenRef = useRef(false)
  const hasCustomHeader = typeof children === 'function'
  const [mobile, setMobile] = useState<boolean | null>(null)
  const [slideOpen, setSlideOpen] = useState(false)
  const prefersReducedMotion = useReducedMotion()
  latestOpen.current = open

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || mobile === null) return
    const setSlidePosition = (next: boolean) => {
      slideOpenRef.current = next
      setSlideOpen(next)
    }
    if (revealFrame.current !== null) {
      cancelAnimationFrame(revealFrame.current)
      revealFrame.current = null
    }

    if (mobile) {
      // A non-modal desktop dialog must close before it can become modal.
      if (previousMobile.current !== true && dialog.open) dialog.close()
      if (open && !dialog.open) {
        // Let the offscreen surface paint in the top layer before sliding it in.
        setSlidePosition(false)
        dialog.showModal()
        revealFrame.current = requestAnimationFrame(() => {
          revealFrame.current = requestAnimationFrame(() => {
            revealFrame.current = null
            if (latestOpen.current && window.matchMedia(MOBILE_LAYOUT_QUERY).matches) setSlidePosition(true)
          })
        })
        if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = null
          if (!latestOpen.current || !window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return
          requestAnimationFrame(() => {
            if (!latestOpen.current || !window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return
            if (hasCustomHeader) closeButtonRef.current?.focus()
            else headingRef.current?.focus()
          })
        })
      } else if (open) {
        setSlidePosition(true)
      } else if (slideOpenRef.current) {
        setSlidePosition(false)
      } else if (dialog.open) {
        // The panel was dismissed before its entrance animation began.
        dialog.close()
      }
    } else {
      if (previousMobile.current === true && dialog.open) dialog.close()
      setSlidePosition(false)
      if (open) onOpenChange(false)
      if (!dialog.open) dialog.show()
    }
    previousMobile.current = mobile
  }, [hasCustomHeader, mobile, onOpenChange, open])

  useEffect(
    () => () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
      if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current)
    },
    [],
  )

  function close() {
    onOpenChange(false)
  }

  // Use the viewport width so the mobile sheet starts fully beyond its edge,
  // even if the dialog's intrinsic sizing differs from the panel's width.
  const hiddenX = side === 'left' ? '-100vw' : '100vw'
  const motionTransition = prefersReducedMotion ? { duration: 0 } : { duration: 0.24, ease: 'easeOut' as const }

  return (
    <dialog
      ref={dialogRef}
      id={id}
      {...stylex.props(styles.dialog)}
      aria-label={hasCustomHeader ? title : undefined}
      aria-labelledby={hasCustomHeader ? undefined : `${id}-title`}
      closedby="closerequest"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClose={() => {
        if (mobile && latestOpen.current) onOpenChange(false)
        if (mobile && !latestOpen.current) {
          requestAnimationFrame(() => {
            if (latestOpen.current || !window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return
            const trigger = triggerRef.current
            if (trigger?.getClientRects().length) trigger.focus()
          })
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close()
      }}
    >
      <motion.div
        {...stylex.props(styles.surface)}
        initial={false}
        animate={mobile === true ? (slideOpen ? 'open' : 'closed') : 'open'}
        variants={{
          open: { x: 0 },
          closed: { x: hiddenX },
        }}
        transition={motionTransition}
        onAnimationComplete={(definition) => {
          if (definition !== 'closed' || mobile !== true || open) return
          const dialog = dialogRef.current
          if (dialog?.open) dialog.close()
        }}
      >
        {hasCustomHeader ? (
          (
            children as (controls: {
              close: () => void
              closeButtonRef: React.RefObject<HTMLButtonElement | null>
              isDialog: boolean
            }) => React.ReactNode
          )({ close, closeButtonRef, isDialog: mobile === true })
        ) : (
          <>
            <div {...stylex.props(styles.close)}>
              <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} {...stylex.props(ui.sectionHeading)}>
                {title}
              </h2>
              <button {...stylex.props(ui.button, ui.focusVisible, ui.textButton)} type="button" onClick={close}>
                Slide back
              </button>
            </div>
            {children}
          </>
        )}
      </motion.div>
    </dialog>
  )
}
