import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { parseSearchXML, extractTag } from "../lib/xml-parser.js";
import { formatToolError } from "../lib/errors.js";

// Customs legal interpretation search tool - Search for customs law interpretations
export const searchCustomsInterpretationsSchema = z.object({
  query: z.string().optional().describe("Search keyword (e.g., '거래명세서', '세금')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  inq: z.number().optional().describe("Inquiry organization code (질의기관코드)"),
  rpl: z.number().optional().describe("Interpretation organization code (해석기관코드)"),
  gana: z.string().optional().describe("Dictionary search (ga, na, da, etc.)"),
  explYd: z.string().optional().describe("Interpretation date range (YYYYMMDD~YYYYMMDD, e.g., '20200101~20201231')"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("Sort option: lasc/ldes (interpretation name), dasc/ddes (interpretation date)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchCustomsInterpretationsInput = z.infer<typeof searchCustomsInterpretationsSchema>;

export async function searchCustomsInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.inq !== undefined) extraParams.inq = args.inq.toString();
    if (args.rpl !== undefined) extraParams.rpl = args.rpl.toString();
    if (args.gana) extraParams.gana = args.gana;
    if (args.explYd) extraParams.explYd = args.explYd;
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "kcsCgmExpc",
      extraParams,
      apiKey: args.apiKey,
    });

    // parseSearchXML 사용 (rootTag: CgmExpc, itemTag: cgmExpc)
    const { totalCnt, page: currentPage, items: expcs } = parseSearchXML(
      xmlText, "CgmExpc", "cgmExpc",
      (content) => ({
        법령해석일련번호: extractTag(content, "법령해석일련번호"),
        안건명: extractTag(content, "안건명"),
        질의기관코드: extractTag(content, "질의기관코드"),
        질의기관명: extractTag(content, "질의기관명"),
        해석기관코드: extractTag(content, "해석기관코드"),
        해석기관명: extractTag(content, "해석기관명"),
        해석일자: extractTag(content, "해석일자"),
        법령해석상세링크: extractTag(content, "법령해석상세링크"),
      })
    );

    const totalCount = totalCnt;

    if (totalCount === 0) {
      return {
        content: [{
          type: "text",
          text: "검색 결과가 없습니다."
        }]
      };
    }

    let output = `관세청 법령해석 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const expc of expcs) {
      output += `[${expc.법령해석일련번호}] ${expc.안건명}\n`;
      output += `  질의기관: ${expc.질의기관명 || "N/A"}\n`;
      output += `  해석기관: ${expc.해석기관명 || "N/A"}\n`;
      output += `  해석일자: ${expc.해석일자 || "N/A"}\n`;
      if (expc.법령해석상세링크) {
        output += `  링크: ${expc.법령해석상세링크}\n`;
      }
      output += `\n`;
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    return formatToolError(error, "search_customs_interpretations");
  }
}

// Customs legal interpretation text retrieval tool - Get full text of a specific interpretation
export const getCustomsInterpretationTextSchema = z.object({
  id: z.string().describe("Customs interpretation serial number (법령해석일련번호) from search results"),
  interpretationName: z.string().optional().describe("Interpretation name (optional, for verification)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetCustomsInterpretationTextInput = z.infer<typeof getCustomsInterpretationTextSchema>;

export async function getCustomsInterpretationText(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.interpretationName) extraParams.LM = args.interpretationName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "kcsCgmExpc",
      type: "JSON",
      extraParams,
      apiKey: args.apiKey,
    });

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      throw new Error("Failed to parse JSON response from API");
    }

    if (!data.CgmExpcService) {
      throw new Error("Customs interpretation not found or invalid response format");
    }

    const expc = data.CgmExpcService;
    const basic = {
      안건명: expc.안건명,
      법령해석일련번호: expc.법령해석일련번호,
      업무분야: expc.업무분야,
      해석일자: expc.해석일자,
      해석기관명: expc.해석기관명,
      질의기관명: expc.질의기관명,
      등록일시: expc.등록일시
    };
    const content = {
      질의요지: expc.질의요지,
      회답: expc.회답,
      이유: expc.이유,
      관련법령: expc.관련법령,
      관세법령정보포털원문링크: expc.관세법령정보포털원문링크
    };

    let output = `=== ${basic.안건명 || "Customs Interpretation"} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  해석일련번호: ${basic.법령해석일련번호 || "N/A"}\n`;
    output += `  업무분야: ${basic.업무분야 || "N/A"}\n`;
    output += `  해석일자: ${basic.해석일자 || "N/A"}\n`;
    output += `  질의기관: ${basic.질의기관명 || "N/A"}\n`;
    output += `  해석기관: ${basic.해석기관명 || "N/A"}\n`;
    output += `  등록일시: ${basic.등록일시 || "N/A"}\n\n`;

    if (content.질의요지) {
      output += `질의요지:\n${content.질의요지}\n\n`;
    }

    if (content.회답) {
      output += `회답:\n${content.회답}\n\n`;
    }

    if (content.이유) {
      output += `이유:\n${content.이유}\n\n`;
    }

    if (content.관련법령) {
      output += `관련법령:\n${content.관련법령}\n\n`;
    }

    if (content.관세법령정보포털원문링크) {
      output += `원문 링크: ${content.관세법령정보포털원문링크}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_customs_interpretation_text");
  }
}

