/**
 * Streamable HTTP 서버 - 리모트 배포용 (MCP 2025-03-26 스펙 준수)
 */

import express from "express"
import { randomUUID } from "node:crypto"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { sessionStore, setSessionApiKey, deleteSession } from "../lib/session-state.js"
import { VERSION } from "../version.js"

interface SessionTransport {
  transport: StreamableHTTPServerTransport
}

export async function startSSEServer(server: Server, port: number) {
  const app = express()
  const transports: Record<string, SessionTransport> = {}

  // JSON 파싱 미들웨어 (크기 제한 명시)
  app.use(express.json({ limit: "100kb" }))

  // 유휴 세션 정리 (30분)
  const SESSION_IDLE_TIMEOUT = 30 * 60 * 1000
  const MAX_SESSIONS = 100
  setInterval(() => {
    const now = Date.now()
    for (const sid of Object.keys(transports)) {
      const session = transports[sid] as SessionTransport & { lastAccess?: number }
      if (session.lastAccess && now - session.lastAccess > SESSION_IDLE_TIMEOUT) {
        try { session.transport.close() } catch { /* ignore */ }
        delete transports[sid]
        deleteSession(sid)
      }
    }
  }, 5 * 60 * 1000).unref()

  // CORS 설정 (MCP Streamable HTTP 스펙 준수)
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, HEAD")
    res.header("Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, Mcp-Protocol-Version, mcp-protocol-version, Mcp-Session-Id, mcp-session-id, Last-Event-ID, last-event-id, Traceparent, Tracestate"
    )
    res.header("Access-Control-Expose-Headers",
      "Mcp-Session-Id, Content-Type, Mcp-Protocol-Version, Traceparent, Tracestate"
    )
    res.header("Access-Control-Max-Age", "86400")
    res.header("Mcp-Protocol-Version", "2025-03-26")

    if (req.method === "OPTIONS") {
      return res.sendStatus(200)
    }
    next()
  })

  // 헬스체크 엔드포인트
  app.get("/", (req, res) => {
    res.json({
      name: "Korean Law MCP Server",
      version: VERSION,
      status: "running",
      protocol: "streamable-http",
      endpoints: {
        mcp: "/mcp",
        health: "/health"
      }
    })
  })

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  })

  // MCP POST 엔드포인트 (초기화 및 요청 처리)
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    // API 키 추출 (http-server.ts와 동일 패턴)
    const apiKeyFromHeader =
      req.headers["apikey"] ||
      req.headers["law_oc"] ||
      req.headers["law-oc"] ||
      (req.headers["LAW_OC"] as string | undefined) ||
      req.headers["x-api-key"] ||
      req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
      req.headers["x-law-oc"] ||
      (req.query?.apiKey as string | undefined)

    if (sessionId) {
      console.error(`Received MCP request for session: ${sessionId}`)
    } else {
      console.error("New MCP request (no session ID)")
    }

    try {
      let transport: StreamableHTTPServerTransport

      if (sessionId && transports[sessionId]) {
        // 기존 세션 재사용 + 접근 시각 갱신
        ;(transports[sessionId] as any).lastAccess = Date.now()
        transport = transports[sessionId].transport

        // API 키 업데이트 (헤더에서 제공된 경우)
        if (apiKeyFromHeader) {
          setSessionApiKey(sessionId, apiKeyFromHeader as string)
        }

        // AsyncLocalStorage로 세션 ID 격리 (동시 요청 안전)
        await sessionStore.run(sessionId, async () => {
          await transport.handleRequest(req, res, req.body)
        })
        return
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // 새 세션 초기화
        // 세션 수 제한 — transport 생성 전에 체크하여 리소스 누수 방지
        if (Object.keys(transports).length >= MAX_SESSIONS) {
          res.status(503).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: `Max sessions (${MAX_SESSIONS}) reached. Try again later.` },
            id: null,
          })
          return
        }

        const eventStore = new InMemoryEventStore()
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = { transport, lastAccess: Date.now() } as any
            if (apiKeyFromHeader) {
              setSessionApiKey(newSessionId, apiKeyFromHeader as string)
            }
          }
        })

        // 세션 종료 시 정리
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && transports[sid]) {
            console.error(`Transport closed for session ${sid}`)
            delete transports[sid]
            deleteSession(sid)
          }
        }

        // 서버 연결
        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
        return
      } else {
        // 잘못된 요청
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Invalid request: missing session ID or not an initialization request"
          },
          id: null
        })
        return
      }
    } catch (error) {
      console.error("Error handling MCP POST request:", error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        })
      }
    }
  })

  // MCP GET 엔드포인트 (SSE 스트림)
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID")
      return
    }

    const lastEventId = req.headers["last-event-id"]
    if (lastEventId) {
      console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`)
    } else {
      console.error(`Establishing SSE stream for session ${sessionId}`)
    }

    try {
      const transport = transports[sessionId].transport
      await transport.handleRequest(req, res)
    } catch (error) {
      console.error("[GET /mcp] Error:", error)
      if (!res.headersSent) {
        res.status(500).send("Internal server error")
      }
    }
  })

  // MCP DELETE 엔드포인트 (세션 종료)
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID")
      return
    }

    console.error(`Session termination request for ${sessionId}`)

    try {
      const transport = transports[sessionId].transport
      await transport.handleRequest(req, res)
      delete transports[sessionId]
      deleteSession(sessionId)
      console.error(`Session removed: ${sessionId}`)
    } catch (error) {
      console.error("Error handling session termination:", error)
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination")
      }
    }
  })

  // 서버 시작
  app.listen(port, "0.0.0.0", () => {
    console.error(`✓ Korean Law MCP server (Streamable HTTP) listening on port ${port}`)
    console.error(`✓ MCP endpoint: http://0.0.0.0:${port}/mcp`)
    console.error(`✓ Health check: http://0.0.0.0:${port}/health`)
  })

  // 종료 처리
  process.on("SIGINT", async () => {
    console.error("Shutting down server...")
    for (const sessionId in transports) {
      try {
        await transports[sessionId].transport.close()
        delete transports[sessionId]
        deleteSession(sessionId)
      } catch (error) {
        console.error(`Error closing transport ${sessionId}:`, error)
      }
    }
    process.exit(0)
  })
}
