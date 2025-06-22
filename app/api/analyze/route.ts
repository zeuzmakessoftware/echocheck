import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = 'gemini-2.0-flash'

function stripCodeFences(str: string) {
return str
    .replace(/^\s*```[^\n]*\n?/, '') // opening fence
    .replace(/\n?```[\s\n]*$/, '')   // closing fence
    .trim()
}

export async function POST(request: Request) {
  try {
    const { videoUrl, userPrompt } = await request.json()
    if (!videoUrl || !userPrompt) {
      return NextResponse.json({ error: 'Missing videoUrl or userPrompt' }, { status: 400 })
    }

    const AGENTS = [
      { name: 'Advocate', prompt: 'You are The Advocate...' },
      { name: 'Skeptic', prompt: 'You are The Skeptic...' },
      { name: 'Synthesizer', prompt: 'You are The Synthesizer...' }
    ]

    const config = { responseMimeType: 'text/plain' }

    const contentFor = (agentPrompt: string) => [
      {
        role: 'user',
        parts: [
          {
            fileData: { fileUri: videoUrl, mimeType: 'video/*' }
          },
          { text: `${agentPrompt}\n\n${userPrompt}` }
        ]
      }
    ]

    const streamPromises = AGENTS.map(a =>
      ai.models.generateContentStream({ model: MODEL, config, contents: contentFor(a.prompt) })
    )

    const agentStreams = await Promise.all(streamPromises)

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const agentReports: Record<string, string> = {}
        const finished: Record<string, boolean> = {}

        await Promise.all(
          agentStreams.map(async (genStream, idx) => {
            const name = AGENTS[idx].name
            agentReports[name] = ''
            finished[name] = false
            for await (const chunk of genStream) {
              agentReports[name] += chunk.text
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'agent_chunk',
                    payload: { agentName: name, chunk: chunk.text }
                  })}\n\n`
                )
              )
            }
            finished[name] = true
          })
        )

        while (!AGENTS.every(a => finished[a.name])) {
          await new Promise(r => setTimeout(r, 25))
        }

        const metaContents = [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Aggregate the following agent reports into JSON with echoScore, mainPoints, counterpoints.\n\n${JSON.stringify(
                    agentReports
                  )}`
              }
            ]
          }
        ]

        const metaStream = await ai.models.generateContentStream({ model: MODEL, config, contents: metaContents })
        let finalText = ''
        for await (const chunk of metaStream) finalText += chunk.text

        const finalJson = JSON.parse(stripCodeFences(finalText.trim()))
        const result = {
          echoScore: finalJson.echoScore,
          argumentMap: {
            mainPoints: finalJson.mainPoints,
            counterpoints: finalJson.counterpoints
          },
          agentReports: AGENTS.map(a => ({
            agent: a.name,
            findings: agentReports[a.name]
          }))
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'final_result', payload: result })}\n\n`))
        controller.close()
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    })
  } catch {
    return NextResponse.json({ error: 'Failed to analyze video' }, { status: 500 })
  }
}
