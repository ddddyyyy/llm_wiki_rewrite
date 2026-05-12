import { json, readBody, startSse, writeSseEvent } from "../lib/http.js"

export function createApiHandler(services) {
  const {
    projectFs,
    settingsService,
    taskService,
    projectService,
    importHistoryService,
    conversationService,
    ingestService,
    knowledgeBaseService,
    lintService,
    graphService,
    wikiService,
    reviewService,
    sourceManagerService,
    sourceTextCacheService,
  } = services

  return async function handleApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const { pathname } = url

    if (req.method === "GET" && pathname === "/api/health") {
      return json(res, 200, { ok: true, projectsRoot: projectFs.projectsRoot })
    }

    if (req.method === "GET" && pathname === "/api/settings") {
      return json(res, 200, await settingsService.loadSettings())
    }

    if (req.method === "PUT" && pathname === "/api/settings") {
      const body = await readBody(req)
      return json(res, 200, await settingsService.updateSettings(body))
    }

    if (req.method === "GET" && pathname === "/api/projects") {
      return json(res, 200, { projects: await projectService.listProjects() })
    }

    if (req.method === "POST" && pathname === "/api/projects") {
      const project = await projectService.createProject(await readBody(req))
      return json(res, 201, { project })
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/)
    if (projectMatch && req.method === "DELETE") {
      const projectId = decodeURIComponent(projectMatch[1])
      return json(res, 200, await projectService.deleteProject(projectId))
    }

    const treeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tree$/)
    if (req.method === "GET" && treeMatch) {
      const projectId = decodeURIComponent(treeMatch[1])
      const { projectRoot } = projectService.ensureInsideProject(projectId)
      return json(res, 200, { tree: await projectFs.buildTree(projectRoot) })
    }

    const fileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/file$/)
    if (fileMatch && req.method === "GET") {
      const projectId = decodeURIComponent(fileMatch[1])
      const relativePath = url.searchParams.get("path") || ""
      if (
        relativePath.startsWith("raw/sources/")
        && /\.(pdf|doc|docx|pptx|xlsx)$/i.test(relativePath)
      ) {
        const cached = await sourceTextCacheService.ensureCachedText(projectId, relativePath)
        if (cached?.text?.trim()) {
          return json(res, 200, {
            path: relativePath,
            contents: cached.text,
            previewMode: "cached-text",
            cachePath: cached.path,
          })
        }
        return json(res, 200, {
          path: relativePath,
          contents: "",
          previewMode: "download",
        })
      }
      return json(res, 200, await projectService.readProjectFile(projectId, relativePath))
    }

    if (fileMatch && req.method === "PUT") {
      const projectId = decodeURIComponent(fileMatch[1])
      const body = await readBody(req)
      return json(res, 200, await projectService.writeProjectFile(projectId, String(body.path || ""), String(body.contents || "")))
    }

    const downloadMatch = pathname.match(/^\/api\/projects\/([^/]+)\/download$/)
    if (downloadMatch && req.method === "GET") {
      const projectId = decodeURIComponent(downloadMatch[1])
      const relativePath = url.searchParams.get("path") || ""
      const { fullPath, path: normalized } = await projectService.resolveProjectFile(projectId, relativePath)
      const filename = normalized.split("/").pop() || "download"
      const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : ""
      const contentTypes = {
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        csv: "text/csv; charset=utf-8",
        txt: "text/plain; charset=utf-8",
        md: "text/markdown; charset=utf-8",
      }
      const buffer = await projectFs.readFile(fullPath)
      res.writeHead(200, {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      })
      res.end(buffer)
      return
    }

    const uploadMatch = pathname.match(/^\/api\/projects\/([^/]+)\/upload-files$/)
    if (uploadMatch && req.method === "POST") {
      const projectId = decodeURIComponent(uploadMatch[1])
      const body = await readBody(req)
      const upload = await projectService.uploadProjectFiles(projectId, body.files)
      const batch = await importHistoryService.recordImportBatch(projectId, body.files, upload.uploaded)
      return json(res, 200, { ...upload, batch })
    }

    const importHistoryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/import-history$/)
    if (importHistoryMatch && req.method === "GET") {
      const projectId = decodeURIComponent(importHistoryMatch[1])
      return json(res, 200, { batches: await importHistoryService.loadImportHistory(projectId) })
    }

    const sourceDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sources$/)
    if (sourceDeleteMatch && req.method === "DELETE") {
      const projectId = decodeURIComponent(sourceDeleteMatch[1])
      const relativePath = url.searchParams.get("path") || ""
      return json(res, 200, await sourceManagerService.deleteSource(projectId, relativePath))
    }

    const ingestMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ingest$/)
    if (ingestMatch && req.method === "POST") {
      const projectId = decodeURIComponent(ingestMatch[1])
      const body = await readBody(req)
      return json(res, 202, {
        task: await services.startIngestTask(projectId, {
          batchId: String(body.batchId || "").trim() || null,
          sourcePaths: Array.isArray(body.sourcePaths) ? body.sourcePaths : [],
        }),
      })
    }

    const reingestMatch = pathname.match(/^\/api\/projects\/([^/]+)\/reingest-source$/)
    if (reingestMatch && req.method === "POST") {
      const projectId = decodeURIComponent(reingestMatch[1])
      const body = await readBody(req)
      const sourcePath = String(body.path || "").trim()
      if (!sourcePath) {
        throw new Error("Source path is required")
      }
      return json(res, 202, { task: await services.startSourceIngestTask(projectId, sourcePath) })
    }

    const taskListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/)
    if (taskListMatch && req.method === "GET") {
      const projectId = decodeURIComponent(taskListMatch[1])
      await taskService.loadTaskStore()
      return json(res, 200, { tasks: taskService.listProjectTasks(projectId) })
    }

    const knowledgeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/knowledge$/)
    if (knowledgeMatch && req.method === "GET") {
      const projectId = decodeURIComponent(knowledgeMatch[1])
      return json(res, 200, await wikiService.buildKnowledgeView(projectId))
    }

    const graphMatch = pathname.match(/^\/api\/projects\/([^/]+)\/graph$/)
    if (graphMatch && req.method === "GET") {
      const projectId = decodeURIComponent(graphMatch[1])
      return json(res, 200, await graphService.buildProjectGraph(projectId))
    }

    const lintMatch = pathname.match(/^\/api\/projects\/([^/]+)\/lint$/)
    if (lintMatch && req.method === "GET") {
      const projectId = decodeURIComponent(lintMatch[1])
      return json(res, 200, await lintService.runProjectLint(projectId))
    }

    const lensMatch = pathname.match(/^\/api\/projects\/([^/]+)\/lens$/)
    if (lensMatch && req.method === "GET") {
      const projectId = decodeURIComponent(lensMatch[1])
      return json(res, 200, await reviewService.buildProjectLens(projectId))
    }

    const reviewActionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/review-items\/action$/)
    if (reviewActionMatch && req.method === "POST") {
      const projectId = decodeURIComponent(reviewActionMatch[1])
      const body = await readBody(req)
      const key = String(body.key || "").trim()
      const action = String(body.action || "").trim()
      if (!key) throw new Error("Review item key is required")
      if (action === "resolve") {
        return json(res, 200, await reviewService.resolveReviewItem(projectId, key))
      }
      if (action === "reopen") {
        return json(res, 200, await reviewService.reopenReviewItem(projectId, key))
      }
      throw new Error(`Unsupported review action: ${action}`)
    }

    const searchMatch = pathname.match(/^\/api\/projects\/([^/]+)\/search$/)
    if (searchMatch && req.method === "GET") {
      const projectId = decodeURIComponent(searchMatch[1])
      const query = url.searchParams.get("q") || ""
      return json(res, 200, await knowledgeBaseService.searchProject(projectId, query))
    }

    const chatMatch = pathname.match(/^\/api\/projects\/([^/]+)\/chat$/)
    if (chatMatch && req.method === "POST") {
      const projectId = decodeURIComponent(chatMatch[1])
      const body = await readBody(req)
      const conversationId = String(body.conversationId || "").trim()
      let historyMessages = []
      if (conversationId) {
        const loaded = await conversationService.loadConversation(projectId, conversationId).catch(() => null)
        historyMessages = loaded?.messages || []
      }
      const answer = await knowledgeBaseService.chatProject(projectId, body.question, {
        historyMessages,
      })
      if (conversationId) {
        const persisted = await conversationService.appendExchange(projectId, conversationId, {
          question: body.question,
          answer: answer.answer,
          references: answer.references,
        })
        return json(res, 200, {
          ...answer,
          conversationId: persisted.conversation.id,
          conversation: persisted.conversation,
          messages: persisted.messages,
        })
      }
      return json(res, 200, answer)
    }

    const chatStreamMatch = pathname.match(/^\/api\/projects\/([^/]+)\/chat-stream$/)
    if (chatStreamMatch && req.method === "POST") {
      const projectId = decodeURIComponent(chatStreamMatch[1])
      const body = await readBody(req)
      const conversationId = String(body.conversationId || "").trim()
      let historyMessages = []
      if (conversationId) {
        const loaded = await conversationService.loadConversation(projectId, conversationId).catch(() => null)
        historyMessages = loaded?.messages || []
      }
      const turn = await knowledgeBaseService.prepareChatTurn(projectId, body.question, {
        historyMessages,
      })

      startSse(res)
      writeSseEvent(res, "start", {
        conversationId: conversationId || null,
        question: turn.query,
      })

      if (turn.immediate) {
        let payload = {
          ...turn.immediate,
          question: turn.query,
          conversationId: conversationId || null,
        }
        if (conversationId) {
          const persisted = await conversationService.appendExchange(projectId, conversationId, {
            question: turn.query,
            answer: turn.immediate.answer,
            references: turn.immediate.references,
          })
          payload = {
            ...payload,
            conversationId: persisted.conversation.id,
            conversation: persisted.conversation,
            messages: persisted.messages,
          }
        }
        writeSseEvent(res, "final", payload)
        res.end()
        return
      }

      const controller = new AbortController()
      req.on("close", () => controller.abort())
      let combinedAnswer = ""
      await services.llmService.streamChatModel(
        turn.settings,
        turn.llmMessages,
        {
          onToken(token) {
            combinedAnswer += token
            writeSseEvent(res, "token", { token })
          },
          async onDone() {
            if (controller.signal.aborted && !combinedAnswer.trim()) {
              if (!res.writableEnded) res.end()
              return
            }
            const finalized = knowledgeBaseService.finalizeChatAnswer(combinedAnswer, turn.selectedPages)
            let payload = {
              ...finalized,
              question: turn.query,
              conversationId: conversationId || null,
            }
            if (conversationId) {
              const persisted = await conversationService.appendExchange(projectId, conversationId, {
                question: turn.query,
                answer: finalized.answer,
                references: finalized.references,
              })
              payload = {
                ...payload,
                conversationId: persisted.conversation.id,
                conversation: persisted.conversation,
                messages: persisted.messages,
              }
            }
            writeSseEvent(res, "final", payload)
            if (!res.writableEnded) res.end()
          },
          onError(error) {
            writeSseEvent(res, "error", {
              error: error instanceof Error ? error.message : String(error),
            })
            if (!res.writableEnded) res.end()
          },
        },
        controller.signal,
      )
      return
    }

    const conversationsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/conversations$/)
    if (conversationsMatch && req.method === "GET") {
      const projectId = decodeURIComponent(conversationsMatch[1])
      return json(res, 200, await conversationService.listConversations(projectId))
    }

    if (conversationsMatch && req.method === "POST") {
      const projectId = decodeURIComponent(conversationsMatch[1])
      const body = await readBody(req)
      return json(res, 201, await conversationService.createConversation(projectId, body))
    }

    const conversationMatch = pathname.match(/^\/api\/projects\/([^/]+)\/conversations\/([^/]+)$/)
    if (conversationMatch && req.method === "GET") {
      const projectId = decodeURIComponent(conversationMatch[1])
      const conversationId = decodeURIComponent(conversationMatch[2])
      return json(res, 200, await conversationService.loadConversation(projectId, conversationId))
    }

    if (conversationMatch && req.method === "DELETE") {
      const projectId = decodeURIComponent(conversationMatch[1])
      const conversationId = decodeURIComponent(conversationMatch[2])
      return json(res, 200, await conversationService.deleteConversation(projectId, conversationId))
    }

    const regenerateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/conversations\/([^/]+)\/regenerate$/)
    if (regenerateMatch && req.method === "POST") {
      const projectId = decodeURIComponent(regenerateMatch[1])
      const conversationId = decodeURIComponent(regenerateMatch[2])
      const preview = await conversationService.previewRegenerate(projectId, conversationId)
      const answer = await knowledgeBaseService.chatProject(projectId, preview.removedQuestion, {
        historyMessages: preview.messages,
      })
      const persisted = await conversationService.replaceLastExchange(projectId, conversationId, {
        question: preview.removedQuestion,
        answer: answer.answer,
        references: answer.references,
      })
      return json(res, 200, {
        ...answer,
        conversationId: persisted.conversation.id,
        conversation: persisted.conversation,
        messages: persisted.messages,
      })
    }

    const regenerateStreamMatch = pathname.match(/^\/api\/projects\/([^/]+)\/conversations\/([^/]+)\/regenerate-stream$/)
    if (regenerateStreamMatch && req.method === "POST") {
      const projectId = decodeURIComponent(regenerateStreamMatch[1])
      const conversationId = decodeURIComponent(regenerateStreamMatch[2])
      const preview = await conversationService.previewRegenerate(projectId, conversationId)
      const turn = await knowledgeBaseService.prepareChatTurn(projectId, preview.removedQuestion, {
        historyMessages: preview.messages,
      })

      startSse(res)
      writeSseEvent(res, "start", {
        conversationId,
        question: preview.removedQuestion,
        regenerate: true,
      })

      if (turn.immediate) {
        const persisted = await conversationService.replaceLastExchange(projectId, conversationId, {
          question: preview.removedQuestion,
          answer: turn.immediate.answer,
          references: turn.immediate.references,
        })
        writeSseEvent(res, "final", {
          ...turn.immediate,
          question: preview.removedQuestion,
          conversationId: persisted.conversation.id,
          conversation: persisted.conversation,
          messages: persisted.messages,
        })
        res.end()
        return
      }

      const controller = new AbortController()
      req.on("close", () => controller.abort())
      let combinedAnswer = ""
      await services.llmService.streamChatModel(
        turn.settings,
        turn.llmMessages,
        {
          onToken(token) {
            combinedAnswer += token
            writeSseEvent(res, "token", { token })
          },
          async onDone() {
            if (controller.signal.aborted && !combinedAnswer.trim()) {
              if (!res.writableEnded) res.end()
              return
            }
            const finalized = knowledgeBaseService.finalizeChatAnswer(combinedAnswer, turn.selectedPages)
            const persisted = await conversationService.replaceLastExchange(projectId, conversationId, {
              question: preview.removedQuestion,
              answer: finalized.answer,
              references: finalized.references,
            })
            writeSseEvent(res, "final", {
              ...finalized,
              question: preview.removedQuestion,
              conversationId: persisted.conversation.id,
              conversation: persisted.conversation,
              messages: persisted.messages,
            })
            if (!res.writableEnded) res.end()
          },
          onError(error) {
            writeSseEvent(res, "error", {
              error: error instanceof Error ? error.message : String(error),
            })
            if (!res.writableEnded) res.end()
          },
        },
        controller.signal,
      )
      return
    }

    const synthesisMatch = pathname.match(/^\/api\/projects\/([^/]+)\/synthesis-from-chat$/)
    if (synthesisMatch && req.method === "POST") {
      const projectId = decodeURIComponent(synthesisMatch[1])
      const body = await readBody(req)
      return json(res, 200, await wikiService.createSynthesisFromAnswer(projectId, body))
    }

    return json(res, 404, { error: "Not found" })
  }
}
