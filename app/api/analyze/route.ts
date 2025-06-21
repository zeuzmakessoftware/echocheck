import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = 'gemini-2.0-flash'

function stripCodeFences(s: string) {
    return s
    .replace(/^\s*```[a-zA-Z0-9]*\s*/g, '')
    .replace(/\s*```\s*$/g, '')
    .trim();
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
    const chats = AGENTS.map(agent =>
      ai.chats.create({ model: MODEL, config: { systemInstruction: agent.prompt } })
    )
    const streamPromises = chats.map(chat =>
      chat.sendMessageStream({ message: `TRANSCRIPT_URL: ${videoUrl}\nPROMPT: ${userPrompt}` })
    )
    const agentStreams = await Promise.all(streamPromises)
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const agentReports: Record<string,string> = {}
        const finishFlags: Record<string,boolean> = {}
        await Promise.all(
          agentStreams.map(async (genStream, idx) => {
            const name = AGENTS[idx].name
            agentReports[name] = ''
            finishFlags[name] = false
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
            finishFlags[name] = true
          })
        )
        const allDone = () => AGENTS.every(a => finishFlags[a.name])
        while (!allDone()) {
          await new Promise(res => setTimeout(res, 50))
        }
        const metaChat = ai.chats.create({
          model: MODEL,
          config: {
            systemInstruction:
              'Aggregate the following agent reports into echoScore, mainPoints, and counterpoints JSON.'
          }
        })
        const metaStream = await metaChat.sendMessageStream({
          message: stripCodeFences(JSON.stringify(agentReports))
        })
        let finalText = ''
        for await (const chunk of metaStream) {
          finalText += chunk.text
        }
        const finalJson = JSON.parse(stripCodeFences(finalText))
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
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'final_result', payload: result })}\n\n`
          )
        )
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
