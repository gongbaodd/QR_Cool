'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useDropzone } from 'react-dropzone'
import type { FileRejection } from 'react-dropzone'
import * as stylex from '@stylexjs/stylex'
import type { ContentKind, EmailFields, SmsFields, WifiFields } from '@/lib/editor/content-input'
import { buildEmailContent, buildSmsContent, buildWifiContent, validPhone } from '@/lib/editor/content-input'
import { contentSchema, MAX_IMAGE_BYTES } from '@/lib/editor/schema'
import { parsePngHeader } from '@/lib/editor/png-guard'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

type ModalKind = Extract<ContentKind, 'WiFi' | 'SMS' | 'Email' | 'QRCode'>

const styles = stylex.create({
  dialog: {
    width: 'min(34rem, 92vw)',
    maxHeight: '86vh',
    overflow: 'auto',
    paddingBlock: 20,
    paddingInline: 22,
    color: tokens.ink,
    backgroundColor: tokens.card,
    fontFamily: tokens.handFont,
    fontSize: '1.125rem',
    lineHeight: 1.7,
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
    '::backdrop': {
      backgroundColor: 'rgba(16, 18, 17, 0.45)',
      backdropFilter: 'blur(2px)',
    },
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  title: { margin: 0, fontSize: '1.25rem', fontWeight: 400 },
  fields: { display: 'grid', gap: 14 },
  field: { fontSize: '1rem' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  select: { display: 'block', width: '100%', marginTop: 8 },
  dropzone: {
    display: 'grid',
    placeItems: 'center',
    minHeight: 130,
    padding: 18,
    textAlign: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    backgroundColor: tokens.paper,
    cursor: 'pointer',
    ':focus-visible': { outlineWidth: 3, outlineStyle: 'dashed', outlineColor: tokens.accent, outlineOffset: 3 },
  },
  error: { display: 'block', color: tokens.danger, fontSize: '0.9375rem', margin: '8px 0 0' },
})

const modalKinds: ModalKind[] = ['WiFi', 'SMS', 'Email', 'QRCode']

function isModalKind(kind: ContentKind | null): kind is ModalKind {
  return kind !== null && modalKinds.includes(kind as ModalKind)
}

async function decodeUploadedQr(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Choose a PNG no larger than 10 MiB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { width, height } = parsePngHeader(bytes, 'qr')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser could not read the PNG image.')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, width, height)
    const jsQrModule = await import('jsqr')
    const decoded = jsQrModule.default(pixels.data, width, height, { inversionAttempts: 'attemptBoth' })
    if (!decoded) throw new Error('No readable QR code was found in this PNG.')
    const parsed = contentSchema.safeParse(decoded.data)
    if (!parsed.success) throw new Error('This QR must contain one line of text within the QR capacity limit.')
    return parsed.data
  } finally {
    bitmap.close()
  }
}

export default function ContentInputDialog({
  kind,
  onClose,
  onContentChange,
  onContentInvalid,
  onSubmit,
}: {
  kind: ContentKind | null
  onClose: () => void
  onContentChange: (value: string) => void
  onContentInvalid: () => void
  onSubmit: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const requestId = useRef(0)
  const previousKind = useRef(kind)
  const titleId = useId()
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [wifi, setWifi] = useState<WifiFields>({ name: '', encryption: 'WPA/WPA2', password: '' })
  const [sms, setSms] = useState<SmsFields>({ phone: '', message: '' })
  const [email, setEmail] = useState<EmailFields>({ email: '', subject: '', message: '' })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (previousKind.current !== kind) {
      requestId.current += 1
      setUploading(false)
      setError(null)
      setTouched({})
      setSubmitted(false)
      previousKind.current = kind
    }
    if (isModalKind(kind) && !dialog.open) dialog.showModal()
    else if (!isModalKind(kind) && dialog.open) dialog.close()
  }, [kind])

  useEffect(
    () => () => {
      requestId.current += 1
    },
    [],
  )

  const acceptContent = (value: string) => {
    setError(null)
    onContentChange(value)
  }

  const handleWifiChange = (next: WifiFields) => {
    setWifi(next)
    const payload = buildWifiContent(next)
    if (payload) acceptContent(payload)
    else {
      onContentInvalid()
      setError(next.name.trim() && next.password ? 'This WiFi information exceeds QR capacity.' : null)
    }
  }
  const handleSmsChange = (next: SmsFields) => {
    setSms(next)
    const payload = buildSmsContent(next)
    if (payload) acceptContent(payload)
    else {
      onContentInvalid()
      setError(validPhone(next.phone) && next.message.trim() ? 'This SMS message exceeds QR capacity.' : null)
    }
  }
  const handleEmailChange = (next: EmailFields) => {
    setEmail(next)
    const payload = buildEmailContent(next)
    if (payload) acceptContent(payload)
    else {
      onContentInvalid()
      setError(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email.trim()) ? 'This email information exceeds QR capacity.' : null,
      )
    }
  }

  const processFile = useCallback(
    async (file: File) => {
      const request = ++requestId.current
      setError(null)
      setUploading(true)
      try {
        const content = await decodeUploadedQr(file)
        if (request !== requestId.current) return
        onContentChange(content)
        onSubmit()
        dialogRef.current?.close()
      } catch (cause) {
        if (request !== requestId.current) return
        setError(cause instanceof Error ? cause.message : 'Could not read this QR image.')
      } finally {
        if (request === requestId.current) setUploading(false)
      }
    },
    [onContentChange, onSubmit],
  )

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length) {
        const tooLarge = rejected.some((entry) => entry.errors.some((issue) => issue.code === 'file-too-large'))
        setError(tooLarge ? 'Choose a PNG no larger than 10 MiB.' : 'Choose a PNG QR image.')
        return
      }
      const file = accepted[0]
      if (file) void processFile(file)
    },
    [processFile],
  )
  const dropzone = useDropzone({
    accept: { 'image/png': ['.png'] },
    maxSize: MAX_IMAGE_BYTES,
    maxFiles: 1,
    multiple: false,
    disabled: uploading,
    onDrop,
  })

  function closeDialog() {
    requestId.current += 1
    setUploading(false)
    setError(null)
    onClose()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (kind === 'WiFi') {
      const payload = buildWifiContent(wifi)
      if (!payload) {
        onContentInvalid()
        return setError(
          wifi.name.trim() && wifi.password
            ? 'This WiFi information exceeds QR capacity.'
            : 'Enter a network name and password to update the preview.',
        )
      }
      onContentChange(payload)
    } else if (kind === 'SMS') {
      const payload = buildSmsContent(sms)
      if (!payload) {
        onContentInvalid()
        return setError(
          validPhone(sms.phone) && sms.message.trim()
            ? 'This SMS message exceeds QR capacity.'
            : 'Enter a valid phone number and message to update the preview.',
        )
      }
      onContentChange(payload)
    } else if (kind === 'Email') {
      const payload = buildEmailContent(email)
      if (!payload) {
        onContentInvalid()
        return setError(
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email.trim())
            ? 'This email information exceeds QR capacity.'
            : 'Enter a valid email address to update the preview.',
        )
      }
      onContentChange(payload)
    }
    setError(null)
    onSubmit()
  }

  function fieldError(name: string, invalid: boolean, message: string): string | null {
    return (submitted || touched[name]) && invalid ? message : null
  }

  const dialogKind = isModalKind(kind) ? kind : null

  return (
    <dialog
      {...stylex.props(styles.dialog)}
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      onClose={closeDialog}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            event.currentTarget.close()
        }
      }}
    >
      {dialogKind && (
        <>
          <div {...stylex.props(styles.header)}>
            <h2 {...stylex.props(styles.title)} id={titleId}>
              {dialogKind} to QR code
            </h2>
            <button
              {...stylex.props(ui.button, ui.textButton)}
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              Close
            </button>
          </div>
          {dialogKind === 'QRCode' ? (
            <div>
              <p {...stylex.props(ui.hint)}>
                Upload a PNG QR code. Its text will be decoded on this device and styled in the preview.
              </p>
              <div {...dropzone.getRootProps()} {...stylex.props(styles.dropzone)}>
                <input {...dropzone.getInputProps()} aria-label="Upload QR code PNG" />
                <span>{uploading ? 'Reading QR code…' : 'Drop a QR PNG here, or choose a file'}</span>
              </div>
              {error && (
                <p {...stylex.props(styles.error)} role="alert">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <form noValidate onSubmit={submit}>
              <div {...stylex.props(styles.fields)}>
                {dialogKind === 'WiFi' && (
                  <>
                    <label {...stylex.props(ui.label)} htmlFor="wifi-name">
                      Network name
                      <input
                        {...stylex.props(ui.field, styles.field)}
                        id="wifi-name"
                        name="networkName"
                        autoComplete="off"
                        value={wifi.name}
                        aria-invalid={!!fieldError('wifi-name', !wifi.name.trim(), 'Enter a network name.')}
                        aria-describedby={
                          fieldError('wifi-name', !wifi.name.trim(), 'Enter a network name.')
                            ? 'wifi-name-error'
                            : undefined
                        }
                        onBlur={() => setTouched((current) => ({ ...current, 'wifi-name': true }))}
                        onChange={(event) => handleWifiChange({ ...wifi, name: event.target.value })}
                      />
                      {fieldError('wifi-name', !wifi.name.trim(), 'Enter a network name.') && (
                        <span id="wifi-name-error" {...stylex.props(styles.error)}>
                          {fieldError('wifi-name', !wifi.name.trim(), 'Enter a network name.')}
                        </span>
                      )}
                    </label>
                    <label {...stylex.props(ui.label)} htmlFor="wifi-encryption">
                      Encryption
                      <select
                        {...stylex.props(ui.field, ui.select, styles.field, styles.select)}
                        id="wifi-encryption"
                        name="encryption"
                        value={wifi.encryption}
                        onChange={(event) =>
                          handleWifiChange({ ...wifi, encryption: event.target.value as WifiFields['encryption'] })
                        }
                      >
                        <option value="WEP">WEP</option>
                        <option value="WPA/WPA2">WPA/WPA2</option>
                      </select>
                    </label>
                    <label {...stylex.props(ui.label)} htmlFor="wifi-password">
                      Password
                      <input
                        {...stylex.props(ui.field, styles.field)}
                        id="wifi-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        value={wifi.password}
                        aria-invalid={!!fieldError('wifi-password', !wifi.password, 'Enter the network password.')}
                        aria-describedby={
                          fieldError('wifi-password', !wifi.password, 'Enter the network password.')
                            ? 'wifi-password-error'
                            : undefined
                        }
                        onBlur={() => setTouched((current) => ({ ...current, 'wifi-password': true }))}
                        onChange={(event) => handleWifiChange({ ...wifi, password: event.target.value })}
                      />
                      {fieldError('wifi-password', !wifi.password, 'Enter the network password.') && (
                        <span id="wifi-password-error" {...stylex.props(styles.error)}>
                          {fieldError('wifi-password', !wifi.password, 'Enter the network password.')}
                        </span>
                      )}
                    </label>
                  </>
                )}
                {dialogKind === 'SMS' && (
                  <>
                    <label {...stylex.props(ui.label)} htmlFor="sms-phone">
                      Phone
                      <input
                        {...stylex.props(ui.field, styles.field)}
                        id="sms-phone"
                        name="phone"
                        type="tel"
                        autoComplete="tel"
                        value={sms.phone}
                        aria-invalid={!!fieldError('sms-phone', !validPhone(sms.phone), 'Enter a valid phone number.')}
                        aria-describedby={
                          fieldError('sms-phone', !validPhone(sms.phone), 'Enter a valid phone number.')
                            ? 'sms-phone-error'
                            : undefined
                        }
                        onBlur={() => setTouched((current) => ({ ...current, 'sms-phone': true }))}
                        onChange={(event) => handleSmsChange({ ...sms, phone: event.target.value })}
                      />
                      {fieldError('sms-phone', !validPhone(sms.phone), 'Enter a valid phone number.') && (
                        <span id="sms-phone-error" {...stylex.props(styles.error)}>
                          {fieldError('sms-phone', !validPhone(sms.phone), 'Enter a valid phone number.')}
                        </span>
                      )}
                    </label>
                    <label {...stylex.props(ui.label)} htmlFor="sms-message">
                      Message
                      <textarea
                        {...stylex.props(ui.field, ui.textarea, styles.field)}
                        id="sms-message"
                        name="message"
                        value={sms.message}
                        aria-invalid={!!fieldError('sms-message', !sms.message.trim(), 'Enter a message.')}
                        aria-describedby={
                          fieldError('sms-message', !sms.message.trim(), 'Enter a message.')
                            ? 'sms-message-error'
                            : undefined
                        }
                        onBlur={() => setTouched((current) => ({ ...current, 'sms-message': true }))}
                        onChange={(event) => handleSmsChange({ ...sms, message: event.target.value })}
                      />
                      {fieldError('sms-message', !sms.message.trim(), 'Enter a message.') && (
                        <span id="sms-message-error" {...stylex.props(styles.error)}>
                          {fieldError('sms-message', !sms.message.trim(), 'Enter a message.')}
                        </span>
                      )}
                    </label>
                  </>
                )}
                {dialogKind === 'Email' && (
                  <>
                    <label {...stylex.props(ui.label)} htmlFor="email-address">
                      Email
                      <input
                        {...stylex.props(ui.field, styles.field)}
                        id="email-address"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email.email}
                        aria-invalid={
                          !!fieldError(
                            'email-address',
                            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email.trim()),
                            'Enter a valid email address.',
                          )
                        }
                        aria-describedby={
                          fieldError(
                            'email-address',
                            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email.trim()),
                            'Enter a valid email address.',
                          )
                            ? 'email-address-error'
                            : undefined
                        }
                        onBlur={() => setTouched((current) => ({ ...current, 'email-address': true }))}
                        onChange={(event) => handleEmailChange({ ...email, email: event.target.value })}
                      />
                      {fieldError(
                        'email-address',
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email.trim()),
                        'Enter a valid email address.',
                      ) && (
                        <span id="email-address-error" {...stylex.props(styles.error)}>
                          {fieldError(
                            'email-address',
                            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email.trim()),
                            'Enter a valid email address.',
                          )}
                        </span>
                      )}
                    </label>
                    <label {...stylex.props(ui.label)} htmlFor="email-subject">
                      Subject
                      <input
                        {...stylex.props(ui.field, styles.field)}
                        id="email-subject"
                        name="subject"
                        value={email.subject}
                        onChange={(event) => handleEmailChange({ ...email, subject: event.target.value })}
                      />
                    </label>
                    <label {...stylex.props(ui.label)} htmlFor="email-message">
                      Message
                      <textarea
                        {...stylex.props(ui.field, ui.textarea, styles.field)}
                        id="email-message"
                        name="message"
                        value={email.message}
                        onChange={(event) => handleEmailChange({ ...email, message: event.target.value })}
                      />
                    </label>
                  </>
                )}
              </div>
              {error && (
                <p {...stylex.props(styles.error)} role="alert">
                  {error}
                </p>
              )}
              <div {...stylex.props(styles.actions)}>
                <button {...stylex.props(ui.button, ui.textButton)} type="submit">
                  Update preview
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </dialog>
  )
}
