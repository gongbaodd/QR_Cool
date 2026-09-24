import { contentSchema } from './schema'

export type ContentKind = 'URL' | 'Text' | 'Phone' | 'WiFi' | 'SMS' | 'Email' | 'QRCode'
export type WifiEncryption = 'WEP' | 'WPA/WPA2'

export interface WifiFields {
  name: string
  encryption: WifiEncryption
  password: string
}

export interface SmsFields {
  phone: string
  message: string
}

export interface EmailFields {
  email: string
  subject: string
  message: string
}

function validContent(value: string): string | null {
  return contentSchema.safeParse(value).success ? value : null
}

export function validPhone(value: string): boolean {
  const phone = value.trim().replace(/[ ()-]/g, '')
  return /^\+?\d{3,}$/.test(phone)
}

export function buildSimpleContent(kind: 'URL' | 'Text' | 'Phone', value: string): string | null {
  const text = value.trim()
  if (!text || /[\r\n]/.test(value)) return null

  if (kind === 'Text') return validContent(value)
  if (kind === 'Phone') {
    if (!validPhone(text)) return null
    return validContent(`tel:${text.replace(/[ ()-]/g, '')}`)
  }

  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? validContent(value) : null
  } catch {
    return null
  }
}

function escapeWifi(value: string): string {
  return value.replace(/[\\;:,"]/g, '\\$&').replace(/\r?\n/g, '\\n')
}

export function buildWifiContent(fields: WifiFields): string | null {
  if (!fields.name.trim() || !fields.password) return null
  const encryption = fields.encryption === 'WPA/WPA2' ? 'WPA' : 'WEP'
  return validContent(`WIFI:T:${encryption};S:${escapeWifi(fields.name)};P:${escapeWifi(fields.password)};;`)
}

export function buildSmsContent(fields: SmsFields): string | null {
  if (!validPhone(fields.phone) || !fields.message.trim()) return null
  const phone = fields.phone.trim().replace(/[ ()-]/g, '')
  const message = fields.message.replace(/\r?\n/g, '\\n')
  return validContent(`SMSTO:${phone}:${message}`)
}

export function buildEmailContent(fields: EmailFields): string | null {
  const email = fields.email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  const params = new URLSearchParams()
  if (fields.subject) params.set('subject', fields.subject)
  if (fields.message) params.set('body', fields.message)
  const query = params.toString()
  return validContent(`mailto:${email}${query ? `?${query}` : ''}`)
}
