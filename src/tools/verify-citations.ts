/**
 * verify_citations — LLM 환각 방지 인용 검증 도구
 *
 * 입력 텍스트에서 "법령명 제N조(의M)? 제K항? 제L호?" 형태 인용을 추출하고,
 * 각 인용의 실존/현행성을 법제처 API로 교차검증.
 *
 * 주요 검증:
 *   ✓ 법령·조문이 법제처 DB에 존재
 *   ✗ 법령 자체 없음 / 해당 조문 없음 (존재 범위 힌트 제공)
 *   ⚠ 법령명 추출 실패 / 항 번호 불일치
 *
 * 타겟: 법률AI 서비스, 로펌, 법학생. ChatGPT/Claude가 쓴 법률 답변 검증에 사용.
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { normalizeLawSearchText, resolveLawAlias } from "../lib/search-normalizer.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const VerifyCitationsSchema = z.object({
  text: z.string().min(1).describe("검증할 법률 텍스트 (LLM 답변/계약서/판결문 등). 조문 인용이 포함된 문자열"),
  maxCitations: z.number().min(1).max(30).optional().default(15).describe("검증할 최대 인용 개수 (기본 15, 많을수록 느림)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type VerifyCitationsInput = z.infer<typeof VerifyCitationsSchema>

interface ParsedCitation {
  raw: string
  lawName?: string
  jo: number
  joBranch?: number
  hang?: number
  ho?: number
  joCode: string
  displayArticle: string
}

// 조문 인용 패턴 — "제N조", "제N조의M", "제N조 제K항 제L호"
const ARTICLE_REGEX = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/g

// 조문 인용 직전 30자에서 법령명 스캔 — "XX법/법률/시행령/시행규칙/규칙/규정/조례"로 끝나는 것
const LAW_NAME_REGEX = /([가-힣][가-힣·ㆍ\s]{0,30}?(?:법률|법|시행령|시행규칙|규칙|규정|조례))$/

function parseCitations(text: string, maxCitations: number): ParsedCitation[] {
  const citations: ParsedCitation[] = []
  const seen = new Set<string>()

  ARTICLE_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ARTICLE_REGEX.exec(text)) !== null && citations.length < maxCitations) {
    const [raw, joStr, branchStr, hangStr, hoStr] = m
    if (!joStr) continue

    // 직전 30자에서 법령명 역추적
    const lookbackStart = Math.max(0, m.index - 30)
    const lookback = text.slice(lookbackStart, m.index).replace(/\s+$/, "")
    const lawMatch = lookback.match(LAW_NAME_REGEX)
    const lawName = lawMatch ? lawMatch[1].replace(/\s+/g, " ").trim() : undefined

    const jo = parseInt(joStr, 10)
    const joBranch = branchStr ? parseInt(branchStr, 10) : undefined
    const displayArticle = joBranch ? `제${jo}조의${joBranch}` : `제${jo}조`

    let joCode: string
    try {
      joCode = buildJO(displayArticle)
    } catch {
      continue  // 코드 변환 실패 시 skip
    }

    const key = `${(lawName || "_").toLowerCase()}::${joCode}::${hangStr || ""}::${hoStr || ""}`
    if (seen.has(key)) continue
    seen.add(key)

    citations.push({
      raw: raw.trim(),
      lawName,
      jo,
      joBranch,
      hang: hangStr ? parseInt(hangStr, 10) : undefined,
      ho: hoStr ? parseInt(hoStr, 10) : undefined,
      joCode,
      displayArticle,
    })
  }
  return citations
}

function formatCitationLabel(c: ParsedCitation): string {
  const law = c.lawName || "(법령명 미지정)"
  let label = `${law} ${c.displayArticle}`
  if (c.hang) label += ` 제${c.hang}항`
  if (c.ho) label += ` 제${c.ho}호`
  return label
}

async function verifyOne(
  apiClient: LawApiClient,
  cite: ParsedCitation,
  apiKey?: string
): Promise<string> {
  const label = formatCitationLabel(cite)

  if (!cite.lawName) {
    return `⚠ ${label} — 법령명 추출 실패 (앞 문맥에 법령명 명시 필요)`
  }

  // 1단계: 법령 검색으로 MST 획득
  let mst: string | undefined
  let officialName: string | undefined
  try {
    const canonical = resolveLawAlias(normalizeLawSearchText(cite.lawName)).canonical
    const xmlText = await apiClient.searchLaw(canonical, apiKey)
    const doc = new DOMParser().parseFromString(xmlText, "text/xml")
    const laws = doc.getElementsByTagName("law")
    if (laws.length === 0) {
      return `✗ ${label} — 법제처 DB에 해당 법령 없음 (법령명 오탈자 가능)`
    }
    mst = laws[0].getElementsByTagName("법령일련번호")[0]?.textContent || undefined
    officialName = laws[0].getElementsByTagName("법령명한글")[0]?.textContent || undefined
    if (!mst) return `⚠ ${label} — MST 추출 실패`
  } catch (e) {
    return `⚠ ${label} — 법령 검색 실패: ${e instanceof Error ? e.message : String(e)}`
  }

  // 2단계: 해당 조문 조회
  try {
    const jsonText = await apiClient.getLawText({ mst, jo: cite.joCode, apiKey })
    const json = JSON.parse(jsonText)
    const rawUnits = json?.법령?.조문?.조문단위
    const units = Array.isArray(rawUnits) ? rawUnits : rawUnits ? [rawUnits] : []
    const found = units.find((u: any) => u.조문여부 === "조문")

    if (!found) {
      // 전체 범위 조회로 힌트 제공
      let rangeHint = ""
      try {
        const fullJson = JSON.parse(await apiClient.getLawText({ mst, apiKey }))
        const fullRaw = fullJson?.법령?.조문?.조문단위
        const fullUnits = Array.isArray(fullRaw) ? fullRaw : fullRaw ? [fullRaw] : []
        const nums = fullUnits
          .filter((u: any) => u.조문여부 === "조문" && u.조문번호)
          .map((u: any) => parseInt(u.조문번호, 10))
          .filter((n: number) => !isNaN(n))
        if (nums.length > 0) {
          rangeHint = ` (존재 범위: 제${Math.min(...nums)}조~제${Math.max(...nums)}조)`
        }
      } catch { /* ignore */ }
      return `✗ ${label} — 해당 조문 없음${rangeHint}`
    }

    // 3단계: 항 검증 (명시된 경우)
    const officialLabel = officialName ? `${officialName} ${cite.displayArticle}` : label
    const joTitle = found.조문제목 ? `(${found.조문제목})` : ""

    if (cite.hang) {
      const rawHang = found.항
      const hangs = Array.isArray(rawHang) ? rawHang : rawHang ? [rawHang] : []
      const hangNumbers = hangs
        .map((h: any) => parseInt(String(h.항번호 || "").replace(/[^\d]/g, ""), 10))
        .filter((n: number) => !isNaN(n))
      if (hangNumbers.includes(cite.hang)) {
        return `✓ ${officialLabel}${joTitle} 제${cite.hang}항 실존`
      }
      const maxHang = hangNumbers.length > 0 ? Math.max(...hangNumbers) : 0
      return `✗ ${label}${joTitle} — 제${cite.hang}항 없음 (최대 제${maxHang}항)`
    }

    return `✓ ${officialLabel}${joTitle} 실존`
  } catch (e) {
    return `⚠ ${label} — 조문 조회 실패: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function verifyCitations(
  apiClient: LawApiClient,
  input: VerifyCitationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const citations = parseCitations(input.text, input.maxCitations ?? 15)
    if (citations.length === 0) {
      return {
        content: [{
          type: "text",
          text: "인용된 조문이 발견되지 않았습니다.\n\n지원 패턴: '민법 제750조', '상법 제401조의2 제2항 제3호'. 법령명이 빠진 단독 '제N조' 인용은 앞 문맥에서 법령명을 추출하려고 시도합니다.",
        }],
      }
    }

    // 병렬 검증 — Promise.all로 묶어 응답 시간 단축
    const results = await Promise.all(
      citations.map((c) => verifyOne(apiClient, c, input.apiKey))
    )

    const okCount = results.filter((r) => r.startsWith("✓")).length
    const failCount = results.filter((r) => r.startsWith("✗")).length
    const warnCount = results.filter((r) => r.startsWith("⚠")).length

    let output = `== 인용 검증 결과 ==\n총 ${citations.length}건 | ✓ ${okCount} 실존 | ✗ ${failCount} 오류 | ⚠ ${warnCount} 확인필요\n\n`
    for (const line of results) {
      output += `${line}\n`
    }
    if (failCount > 0) {
      output += `\n⚠️ ${failCount}건 인용이 법제처 DB에 실존하지 않습니다. LLM 환각 가능성 — 원문 재확인 필요.\n`
    }
    if (warnCount > 0) {
      output += `\n💡 ⚠ 항목은 법령명 불명확/API 일시 실패 등. 법령명을 명시하거나 재시도하세요.\n`
    }

    return {
      content: [{ type: "text", text: truncateResponse(output) }],
    }
  } catch (error) {
    return formatToolError(error, "verify_citations")
  }
}
