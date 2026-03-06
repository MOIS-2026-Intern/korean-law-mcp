#!/usr/bin/env node

/**
 * Korean Law CLI
 * MCP 서버와 동일한 58개 도구를 커맨드라인에서 직접 실행
 *
 * Usage:
 *   korean-law search_law --query "민법"
 *   korean-law get_law_text --mst 160001 --jo "제1조"
 *   korean-law list
 *   korean-law list --category 판례
 *   korean-law help search_law
 */

import { Command } from "commander"
import { z } from "zod"
import { LawApiClient } from "./lib/api-client.js"
import { allTools } from "./tool-registry.js"
import type { McpTool } from "./lib/types.js"

const VERSION = "1.7.0"

interface CliOption {
  name: string
  description: string
  required: boolean
  type: string
  defaultValue?: unknown
}

/**
 * Zod 스키마 → z.toJSONSchema() → CLI 옵션 추출
 */
function extractOptionsFromSchema(schema: z.ZodSchema): CliOption[] {
  let jsonSchema: Record<string, any>
  try {
    jsonSchema = z.toJSONSchema(schema) as Record<string, any>
  } catch {
    return []
  }

  if (jsonSchema?.type !== "object" || !jsonSchema.properties) {
    return []
  }

  const requiredFields = new Set<string>(jsonSchema.required || [])
  const options: CliOption[] = []

  for (const [key, prop] of Object.entries<any>(jsonSchema.properties)) {
    let type = "string"
    const propType = prop.type

    if (propType === "number" || propType === "integer") {
      type = "number"
    } else if (propType === "boolean") {
      type = "boolean"
    } else if (propType === "array") {
      type = "array"
    }

    // default가 있으면 required에서 제외
    const hasDefault = prop.default !== undefined
    options.push({
      name: key,
      description: prop.description || "",
      required: hasDefault ? false : requiredFields.has(key),
      type,
      defaultValue: prop.default
    })
  }

  return options
}

/**
 * CLI 옵션 값을 적절한 타입으로 변환
 */
function coerceValue(value: string, type: string): unknown {
  switch (type) {
    case "number": return Number(value)
    case "boolean": return value === "true" || value === "1"
    case "array": {
      try { return JSON.parse(value) }
      catch { return value.split(",") }
    }
    default: return value
  }
}

/**
 * 도구 카테고리 추출 (description의 [카테고리] 부분)
 */
function getCategory(tool: McpTool): string {
  const match = tool.description.match(/^\[(.+?)\]/)
  return match ? match[1] : "기타"
}

function createProgram(): Command {
  const program = new Command()
    .name("korean-law")
    .description("한국 법령 검색 CLI - 법제처 API 기반 58개 도구")
    .version(VERSION)

  // ── list 명령 ──
  program
    .command("list")
    .description("사용 가능한 도구 목록")
    .option("-c, --category <category>", "카테고리 필터 (예: 판례, 법령, 비교)")
    .option("--json", "JSON 형식으로 출력")
    .action((opts: { category?: string; json?: boolean }) => {
      let tools = allTools

      if (opts.category) {
        tools = tools.filter(t =>
          getCategory(t).includes(opts.category!)
        )
      }

      if (opts.json) {
        const data = tools.map(t => ({
          name: t.name,
          category: getCategory(t),
          description: t.description
        }))
        console.log(JSON.stringify(data, null, 2))
        return
      }

      // 카테고리별 그룹핑
      const grouped = new Map<string, McpTool[]>()
      for (const tool of tools) {
        const cat = getCategory(tool)
        if (!grouped.has(cat)) grouped.set(cat, [])
        grouped.get(cat)!.push(tool)
      }

      console.log(`\n한국 법령 CLI - ${tools.length}개 도구\n`)
      for (const [cat, catTools] of grouped) {
        console.log(`── ${cat} ──`)
        for (const t of catTools) {
          const desc = t.description.replace(/^\[.+?\]\s*/, "")
          console.log(`  ${t.name.padEnd(35)} ${desc}`)
        }
        console.log()
      }

      console.log("사용법: korean-law <도구명> [옵션]")
      console.log("도움말: korean-law help <도구명>")
    })

  // ── help <tool> 명령 ──
  program
    .command("help <tool-name>")
    .description("도구 상세 도움말")
    .action((toolName: string) => {
      const tool = allTools.find(t => t.name === toolName)
      if (!tool) {
        console.error(`알 수 없는 도구: ${toolName}`)
        console.error(`'korean-law list'로 사용 가능한 도구를 확인하세요.`)
        process.exit(1)
      }

      const options = extractOptionsFromSchema(tool.schema)

      console.log(`\n${tool.name}`)
      console.log(`${"─".repeat(tool.name.length)}`)
      console.log(tool.description)
      console.log()

      if (options.length > 0) {
        console.log("파라미터:")
        for (const opt of options) {
          const reqLabel = opt.required ? "(필수)" : "(선택)"
          const defLabel = opt.defaultValue !== undefined ? ` [기본값: ${opt.defaultValue}]` : ""
          console.log(`  --${opt.name.padEnd(20)} ${reqLabel} ${opt.description}${defLabel}`)
        }
        console.log()
      }

      // 사용 예시
      const example = options
        .filter(o => o.required && o.name !== "apiKey")
        .map(o => `--${o.name} "<값>"`)
        .join(" ")
      console.log(`예시: korean-law ${tool.name} ${example}`)
    })

  // ── 58개 도구를 동적으로 서브커맨드 등록 ──
  for (const tool of allTools) {
    const cmd = program
      .command(tool.name)
      .description(tool.description)

    const options = extractOptionsFromSchema(tool.schema)

    for (const opt of options) {
      const flag = opt.type === "boolean"
        ? `--${opt.name}`
        : `--${opt.name} <value>`

      if (opt.required) {
        cmd.requiredOption(flag, opt.description)
      } else {
        if (opt.defaultValue !== undefined) {
          cmd.option(flag, opt.description, String(opt.defaultValue))
        } else {
          cmd.option(flag, opt.description)
        }
      }
    }

    // --json-input으로 복잡한 입력 지원
    cmd.option("--json-input <json>", "JSON 문자열로 전체 파라미터 전달")

    cmd.action(async (cmdOpts: Record<string, string>) => {
      const apiKey = cmdOpts.apiKey || process.env.LAW_OC || ""
      if (!apiKey) {
        console.error("LAW_OC 환경변수 또는 --apiKey 옵션이 필요합니다.")
        console.error("API 키 발급: https://open.law.go.kr/LSO/openApi/guideResult.do")
        process.exit(1)
      }

      const apiClient = new LawApiClient({ apiKey })

      // 입력 파라미터 구성
      let input: Record<string, unknown>

      if (cmdOpts.jsonInput) {
        try {
          input = JSON.parse(cmdOpts.jsonInput)
        } catch {
          console.error("--json-input 파싱 실패: 유효한 JSON을 입력하세요.")
          process.exit(1)
        }
      } else {
        input = {}
        for (const opt of options) {
          const val = cmdOpts[opt.name]
          if (val !== undefined) {
            input[opt.name] = coerceValue(val, opt.type)
          }
        }
      }

      try {
        const parsed = tool.schema.parse(input)
        const result = await tool.handler(apiClient, parsed)

        for (const c of result.content) {
          console.log(c.text)
        }

        if (result.isError) {
          process.exit(1)
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          console.error("입력 검증 실패:")
          for (const issue of error.issues) {
            console.error(`  ${issue.path.join(".")}: ${issue.message}`)
          }
          console.error(`\n'korean-law help ${tool.name}'으로 파라미터를 확인하세요.`)
        } else {
          console.error(error instanceof Error ? error.message : String(error))
        }
        process.exit(1)
      }
    })
  }

  return program
}

createProgram().parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
