/**
 * Fetch with retry and timeout
 * - Exponential backoff for 429, 503, 504
 * - AbortController for timeout
 */

export interface FetchWithRetryOptions extends RequestInit {
  /** Request timeout in ms (default: 30000) */
  timeout?: number
  /** Max retry attempts (default: 3) */
  retries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryDelay?: number
  /** HTTP status codes to retry on (default: [429, 503, 504]) */
  retryOn?: number[]
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_RETRIES = 3
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_RETRY_ON = [429, 503, 504]

/**
 * Fetch with automatic retry and timeout
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    retryOn = DEFAULT_RETRY_ON,
    ...fetchOptions
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Success or non-retryable error
      if (response.ok || !retryOn.includes(response.status)) {
        return response
      }

      // Retryable error - check if we have retries left
      if (attempt < retries) {
        const delay = getRetryDelay(response, retryDelay, attempt)
        await sleep(delay)
        continue
      }

      // No retries left
      return response
    } catch (error) {
      clearTimeout(timeoutId)

      // Timeout or network error
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          lastError = new Error(`Request timeout after ${timeout}ms for ${url}`)
        } else {
          lastError = error
        }
      }

      // Retry on network errors
      if (attempt < retries) {
        const delay = getRetryDelay(null, retryDelay, attempt)
        await sleep(delay)
        continue
      }
    }
  }

  throw lastError || new Error("Request failed after retries")
}

/** Retry-After 헤더 우선, 없으면 exponential backoff + jitter */
function getRetryDelay(response: Response | null, retryDelay: number, attempt: number): number {
  if (response) {
    const retryAfter = response.headers.get("Retry-After")
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (!isNaN(seconds) && seconds > 0) {
        return seconds * 1000
      }
    }
  }
  const baseDelay = retryDelay * Math.pow(2, attempt)
  return baseDelay + Math.random() * baseDelay * 0.5
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
