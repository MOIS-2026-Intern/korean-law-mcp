/**
 * search_ordinance Tool - 자치법규 검색
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { normalizeLawSearchText, expandOrdinanceQuery } from "../lib/search-normalizer.js"
import { parseSearchXML, extractTag } from "../lib/xml-parser.js"
import { formatToolError } from "../lib/errors.js"

export const SearchOrdinanceSchema = z.object({
  query: z.string().describe("검색할 자치법규명 (예: '서울', '환경')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchOrdinanceInput = z.infer<typeof SearchOrdinanceSchema>

export async function searchOrdinance(
  apiClient: LawApiClient,
  input: SearchOrdinanceInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 검색어 정규화 (약칭 해결, 오타 보정)
    const normalizedQuery = normalizeLawSearchText(input.query)

    // 1차 검색 시도
    let xmlText = await apiClient.searchOrdinance({
      query: normalizedQuery,
      display: input.display || 20,
      apiKey: input.apiKey
    })

    // parseSearchXML 사용 (rootTag: OrdinSearch, itemTag: law)
    let parsed = parseSearchXML(
      xmlText, "OrdinSearch", "law",
      (content) => ({
        자치법규일련번호: extractTag(content, "자치법규일련번호"),
        자치법규명: extractTag(content, "자치법규명"),
        지자체기관명: extractTag(content, "지자체기관명"),
        공포일자: extractTag(content, "공포일자"),
        시행일자: extractTag(content, "시행일자"),
        자치법규상세링크: extractTag(content, "자치법규상세링크"),
      })
    )
    let totalCount = parsed.totalCnt
    let usedQuery = normalizedQuery

    // 검색 결과 없으면 확장 쿼리로 자동 재시도
    if (totalCount === 0) {
      const { expanded } = expandOrdinanceQuery(input.query)

      for (const expandedQuery of expanded) {
        xmlText = await apiClient.searchOrdinance({
          query: expandedQuery,
          display: input.display || 20,
          apiKey: input.apiKey
        })

        parsed = parseSearchXML(
          xmlText, "OrdinSearch", "law",
          (content) => ({
            자치법규일련번호: extractTag(content, "자치법규일련번호"),
            자치법규명: extractTag(content, "자치법규명"),
            지자체기관명: extractTag(content, "지자체기관명"),
            공포일자: extractTag(content, "공포일자"),
            시행일자: extractTag(content, "시행일자"),
            자치법규상세링크: extractTag(content, "자치법규상세링크"),
          })
        )
        totalCount = parsed.totalCnt

        if (totalCount > 0) {
          usedQuery = expandedQuery
          break
        }
      }
    }

    const currentPage = parsed.page
    const ordinances = parsed.items

    if (totalCount === 0) {
      // 확장 검색도 실패한 경우, 시도한 쿼리들 안내
      const { expanded } = expandOrdinanceQuery(input.query)
      const triedQueries = [normalizedQuery, ...expanded].slice(0, 3).join("', '")
      return {
        content: [{
          type: "text",
          text: `'${input.query}' 검색 결과가 없습니다.\n\n시도한 검색어: '${triedQueries}'`
        }]
      }
    }

    let output = `자치법규 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`

    for (const ordin of ordinances) {
      output += `[${ordin.자치법규일련번호}] ${ordin.자치법규명}\n`
      output += `  지자체: ${ordin.지자체기관명 || "N/A"}\n`
      output += `  공포일: ${ordin.공포일자 || "N/A"}\n`
      output += `  시행일: ${ordin.시행일자 || "N/A"}\n`
      if (ordin.자치법규상세링크) {
        output += `  링크: ${ordin.자치법규상세링크}\n`
      }
      output += `\n`
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: output
      }]
    }
  } catch (error) {
    return formatToolError(error, "search_ordinance")
  }
}

