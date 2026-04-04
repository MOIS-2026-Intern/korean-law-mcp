/**
 * 통일된 에러 처리 모듈
 */

import type { ToolResponse } from "./types.js"

/**
 * 에러 코드
 */
export const ErrorCodes = {
  NOT_FOUND: "LAW_NOT_FOUND",
  INVALID_PARAM: "INVALID_PARAMETER",
  API_ERROR: "EXTERNAL_API_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "REQUEST_TIMEOUT",
  PARSE_ERROR: "PARSE_ERROR",
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/**
 * 법제처 API 에러
 */
export class LawApiError extends Error {
  code: ErrorCode
  suggestions: string[]

  constructor(message: string, code: ErrorCode, suggestions: string[] = []) {
    super(message)
    this.name = "LawApiError"
    this.code = code
    this.suggestions = suggestions
  }

  format(): string {
    let result = `[ERROR] ${this.message}`
    if (this.suggestions.length > 0) {
      result += "\n제안:"
      this.suggestions.forEach((s, i) => {
        result += `\n  ${i + 1}. ${s}`
      })
    }
    return result
  }
}

/**
 * 도구 에러 응답 생성 -- 구조화된 포맷
 *
 * 출력 형식:
 *   ❌ [에러코드] 메시지
 *   🔧 도구: <toolName>
 *   💡 제안: ...
 */
export function formatToolError(error: unknown, context?: string): ToolResponse {
  let code: string
  let msg: string
  let suggestions: string[]

  if (error instanceof LawApiError) {
    code = error.code || ErrorCodes.API_ERROR
    msg = error.message
    suggestions = error.suggestions || []
  } else if (error instanceof Error) {
    // Zod validation 에러 감지
    if (error.name === "ZodError" && Array.isArray((error as any).issues)) {
      code = ErrorCodes.INVALID_PARAM
      msg = (error as any).issues
        .map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
      suggestions = ["파라미터 형식과 필수 값을 확인하세요."]
    } else {
      code = ErrorCodes.API_ERROR
      msg = error.message
      suggestions = []
    }
  } else {
    code = ErrorCodes.API_ERROR
    msg = String(error)
    suggestions = []
  }

  const lines: string[] = []
  lines.push(`[${code}] ${msg}`)

  if (context) {
    lines.push(`도구: ${context}`)
  }

  if (suggestions.length > 0) {
    lines.push("제안:")
    suggestions.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s}`)
    })
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: true,
  }
}

