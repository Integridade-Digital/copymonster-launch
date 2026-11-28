/**
 * The model-facing `generate_image` tool generates an image using the
 * CopyMonster LLM loopback gateway with OpenRouter admin API key.
 *
 * The gateway validates the tenant's session token (HMAC) from the
 * Authorization header, then calls the OpenRouter images API and returns
 * the generated image. The cost in USD is debited from the tenant's
 * quota ledger (not the admin's personal account).
 *
 * @module @deepseek-ai/dsh-tool-fs/src/generate-image
 */

import { defineTool, ToolCallView } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

/** Register the `generate_image` tool on the given context. */
export function applyGenerateImageTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description:
      'Generate an image using the CopyMonster LLM loopback gateway with OpenRouter. The gateway validates the session token and uses the admin\'s OpenRouter API key. Cost is debited from the tenant\'s quota.',
    parameters: {
      prompt: {
        type: 'string',
        description:
          'The text prompt describing the image to generate.',
        required: true,
      },
      model: {
        type: 'string',
        description: 'Optional image generation model override.',
      },
      width: {
        type: 'integer',
        description: 'Optional image width in pixels.',
      },
      height: {
        type: 'integer',
        description: 'Optional image height in pixels.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          created: {
            type: 'integer',
            description: 'Unix timestamp when the image was created.',
          },
          data: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                b64Json: {
                  type: 'string',
                  description: 'Base64-encoded image data.',
                },
                mimeType: {
                  type: 'string',
                  description: 'MIME type of the image.',
                },
              },
              required: ['b64Json', 'mimeType'],
            },
            description: 'Array of generated image data.',
          },
        },
      },
      render: (_args, value: unknown) => {
        // Assert value matches the output schema shape.
        const val = value as { created?: number; data?: Array<{ b64Json: string; mimeType: string }> | undefined }
        const lines: string[] = []
        if (val.created) {
          lines.push(`Generated at: ${new Date(val.created * 1000).toISOString()}`)
        }
        if (val.data && val.data.length > 0) {
          for (let i = 0; i < val.data.length; i++) {
            const item = val.data[i]
            // Assert item is defined since we checked val.data.length > 0
            const typedItem = item as { mimeType: string; b64Json?: string }
            lines.push(
              `Image ${i + 1}: ${typedItem.mimeType}, ${typedItem.b64Json?.length} chars base64`,
            )
          }
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, _exec): Promise<{ created?: number; data?: Array<{ b64Json: string; mimeType: string }> }> {
      // Coerce args.prompt to string safely.
      const prompt = String(args?.prompt)
      if (!prompt || prompt.trim().length === 0) {
        throw new Error('prompt is required and must not be empty')
      }

      // The gateway expects the session token in the Authorization header.
      // The gateway will validate the token and use the admin's OPENROUTER_API_KEY.
      // We forward the request to the gateway loopback.
      const gatewayUrl =
        process.env.COPYMONSTER_LLM_GATEWAY_URL ?? 'http://127.0.0.1:4010/internal/v1/llm'

      const payload = {
        prompt: String(prompt),
        ...(args.model ? { model: String(args.model) } : {}),
        ...(args.width !== undefined ? { width: Number(args.width) } : {}),
        ...(args.height !== undefined ? { height: Number(args.height) } : {}),
      }

      try {
        const res = await fetch(`${gatewayUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(`Gateway error ${res.status}: ${errorText}`)
        }

        const result = await res.json()

        return {
          created: result.created ?? Math.floor(Date.now() / 1000),
          data: (result.data ?? []).map((item: { b64_json: string; mime_type: string }) => ({
            b64Json: item.b64_json,
            mimeType: item.mime_type,
          })),
        }
      } catch (error: unknown) {
        throw new Error(`Failed to generate image: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    isConcurrencySafe: () => true,

    presentCall(args): ToolCallView | undefined {
      const promptTitle = String(args?.prompt).slice(0, 50)
      const hasTruncation = Boolean(args?.prompt) && String(args?.prompt).length > 50
      return {
        card: 'generic',
        title: `Generate image: ${promptTitle}${hasTruncation ? '...' : ''}`,
        kind: 'execute',
      }
    },
  }))
}
