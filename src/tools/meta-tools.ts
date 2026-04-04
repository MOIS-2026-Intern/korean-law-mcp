/**
 * Meta Tools — lite 프로필에서 전체 도구 접근을 위한 디스커버리/실행 도구
 *
 * discover_tools: 의도/카테고리로 사용 가능한 도구 목록 반환
 * execute_tool:   discover로 찾은 도구를 프록시 실행
 */

import { z } from "zod"
import { TOOL_CATEGORIES } from "../lib/tool-profiles.js"
import { formatToolError } from "../lib/errors.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { McpTool, ToolResponse } from "../lib/types.js"

// allTools 참조 (순환참조 방지를 위해 런타임 주입)
let _allTools: McpTool[] = []
export function setAllToolsRef(tools: McpTool[]) {
  _allTools = tools
}

// ========================================
// discover_tools
// ========================================

export const DiscoverToolsSchema = z.object({
  intent: z.string().describe("찾고 싶은 도구의 의도 또는 카테고리 (예: '공정위', '조약', '용어', '헌재')"),
})

export async function discoverTools(
  _apiClient: LawApiClient,
  input: z.infer<typeof DiscoverToolsSchema>
): Promise<ToolResponse> {
  const query = input.intent.toLowerCase()
  const matches: Array<{ category: string; tools: string[] }> = []

  for (const [category, toolNames] of Object.entries(TOOL_CATEGORIES)) {
    if (category.includes(query) || query.includes(category)) {
      matches.push({ category, tools: toolNames })
      continue
    }
    // 도구 이름/설명에서도 매칭
    const matchedTools = toolNames.filter(name => {
      const tool = _allTools.find(t => t.name === name)
      if (!tool) return false
      return name.includes(query) || tool.description.toLowerCase().includes(query)
    })
    if (matchedTools.length > 0) {
      matches.push({ category, tools: matchedTools })
    }
  }

  if (matches.length === 0) {
    // 전체 카테고리 목록 반환
    const categoryList = Object.entries(TOOL_CATEGORIES)
      .map(([cat, tools]) => `• ${cat}: ${tools.length}개 도구`)
      .join("\n")
    return {
      content: [{ type: "text", text: `"${input.intent}"에 해당하는 도구를 찾지 못했습니다.\n\n사용 가능한 카테고리:\n${categoryList}\n\n카테고리명으로 다시 검색해주세요.` }]
    }
  }

  const sections = matches.map(m => {
    const toolDetails = m.tools.map(name => {
      const tool = _allTools.find(t => t.name === name)
      return `  - ${name}: ${tool?.description || "(설명 없음)"}`
    }).join("\n")
    return `[${m.category}]\n${toolDetails}`
  }).join("\n\n")

  return {
    content: [{ type: "text", text: `"${input.intent}" 관련 도구:\n\n${sections}\n\nexecute_tool로 실행하세요.` }]
  }
}

// ========================================
// execute_tool
// ========================================

export const ExecuteToolSchema = z.object({
  tool_name: z.string().describe("실행할 도구 이름 (discover_tools로 확인한 이름)"),
  params: z.record(z.string(), z.unknown()).describe("도구에 전달할 파라미터 객체"),
})

const META_TOOL_NAMES = new Set(["discover_tools", "execute_tool"])

export async function executeTool(
  apiClient: LawApiClient,
  input: z.infer<typeof ExecuteToolSchema>
): Promise<ToolResponse> {
  // 메타 도구 자기 자신 재귀 호출 방지
  if (META_TOOL_NAMES.has(input.tool_name)) {
    return {
      content: [{ type: "text", text: `메타 도구(${input.tool_name})는 execute_tool로 실행할 수 없습니다.` }],
      isError: true
    }
  }

  const tool = _allTools.find(t => t.name === input.tool_name)
  if (!tool) {
    return {
      content: [{ type: "text", text: `도구를 찾을 수 없습니다: ${input.tool_name}\ndiscover_tools로 사용 가능한 도구를 먼저 확인하세요.` }],
      isError: true
    }
  }

  try {
    const parsed = tool.schema.parse(input.params)
    return await tool.handler(apiClient, parsed) as ToolResponse
  } catch (error) {
    return formatToolError(error as Error, input.tool_name)
  }
}
