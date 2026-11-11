import { getAPIUrl } from '@services/config/config'

export type TranscriptionResult = {
  text: string
  language?: string | null
  duration?: number
  model?: string
}

/**
 * Upload a short voice recording to the API's local faster-whisper endpoint.
 * Used when the browser has no Web Speech API (Firefox, Safari, some webviews).
 */
export async function transcribeAudio(
  blob: Blob,
  accessToken: string
): Promise<TranscriptionResult> {
  const type = (blob.type || '').toLowerCase()
  const extension = type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('file', blob, `explanation.${extension}`)
  form.append('language', 'ru')

  const response = await fetch(`${getAPIUrl()}ai/audio/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof data?.detail === 'string'
        ? data.detail
        : 'Не удалось распознать запись'
    )
  }
  return data as TranscriptionResult
}
