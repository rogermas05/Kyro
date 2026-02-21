import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROMPT = `You are parsing an invoice document. Extract the following fields and return ONLY valid JSON with no extra text:
{
  "invoiceNumber": "the invoice number or ID (string, e.g. INV-2024-001)",
  "amount": "the total amount due as a plain number string with no currency symbols (e.g. 15000)",
  "dueDate": "payment due date in YYYY-MM-DD format (e.g. 2025-06-30)",
  "buyerName": "the name of the buyer / bill-to company (string)"
}
If a field cannot be determined, use an empty string "". Do not include any explanation.`

type ParsedInvoice = { invoiceNumber: string; amount: string; dueDate: string; buyerName: string }

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const bytes  = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const isPdf  = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    let message: Anthropic.Message

    if (isPdf) {
      // PDFs use the beta documents API
      message = await client.beta.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role:    'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text',     text: PROMPT },
          ],
        }],
        betas: ['pdfs-2024-09-25'],
      }) as unknown as Anthropic.Message
    } else {
      // Images use the standard API
      message = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role:    'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: (file.type || 'image/png') as Anthropic.Base64ImageSource['media_type'], data: base64 } },
            { type: 'text',  text: PROMPT },
          ],
        }],
      })
    }

    const raw = message.content.find(b => b.type === 'text')
    if (!raw || raw.type !== 'text') return NextResponse.json({ error: 'No response' }, { status: 500 })

    // Strip any markdown fences Claude might add
    const json   = raw.text.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(json) as ParsedInvoice

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[parse-invoice]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
