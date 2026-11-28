/**
 * Model-facing read, read_image, write, and edit tools over `ctx.fs`. This package owns schemas, validation,
 * read windows, formatting, and observation events, never a concrete provider. An optional
 * event policy supplies mutation guards; without one the tools use unconditional provider calls.
 * @module @deepseek-ai/dsh-tool-fs
 */

import type {} from '@deepseek-ai/dsh-working-directory'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-user-approval'
import { applyReadTool, READ_LIMIT, STREAM_MIN_SIZE } from './read.ts'
import { applyWriteTool } from './write.ts'
import { applyEditTool } from './edit.ts'
import { applyReadImageTool } from './read-image.ts'
import { READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from './read-render.ts'
import { FsSandboxController } from './sandbox.ts'
import { defineTool, ToolCallView } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs'

/** Services required by the filesystem tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt', 'workingDirectory']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Register `read` and its guidance. Defaults to true. */
  read?: boolean
  /** Register `read_image` while an attachment store is mounted. Defaults to true. */
  readImage?: boolean
  /** Register `write` and its guidance. Defaults to true. */
  write?: boolean
  /** Register `edit` and its guidance. Defaults to true. */
  edit?: boolean
  /** Default and maximum number of lines returned by one `read` call. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
}
export const Config: z<Config> = z.object({
  read: z.boolean().default(true),
  readImage: z.boolean().default(true),
  write: z.boolean().default(true),
  edit: z.boolean().default(true),
  readLimit: z.number().default(READ_LIMIT),
  readMaxLineLength: z.number().default(READ_MAX_LINE_LENGTH),
  readMaxBytes: z.number().default(READ_MAX_BYTES),
  readStreamMinSize: z.number().default(STREAM_MIN_SIZE),
})

/** Configuration after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Every read cap counts lines/chars/bytes — a positive integer, or windowing arithmetic misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-fs: ${name} must be a positive integer`)
  }
}

/** Register the `generate_image` tool. */
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
            lines.push(
              `Image ${i + 1}: ${item.mimeType}, ${item.b64Json?.length} chars base64`,
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
          data: (result.data ?? []).map((item: unknown) => ({
            b64Json: item.b64_json ?? '',
            mimeType: item.mime_type ?? 'image/png',
          })),
        }
      } catch (error: unknown) {
        throw new Error(`Failed to generate image: ${error.message}`)
      }
    },

    isConcurrencySafe: () => true,

    presentCall(args): ToolCallView | undefined {
      const promptTitle = String(args?.prompt).slice(0, 50)
      const hasTruncation = Boolean(args?.prompt) && String(args?.prompt).length > 50
      return {
        card: 'generic',
        title: `Generate image: ${promptTitle}${hasTruncation ? '...' : ''}`,
        kind: 'generate',
      }
    },
  }))
}

/** Register the selected filesystem tools; `read_image` additionally requires a mounted attachment store. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('readLimit', resolved.readLimit)
  assertPositiveInteger('readMaxLineLength', resolved.readMaxLineLength)
  assertPositiveInteger('readMaxBytes', resolved.readMaxBytes)
  assertPositiveInteger('readStreamMinSize', resolved.readStreamMinSize)
  if (resolved.read) {
    applyReadTool(ctx, {
      limit: resolved.readLimit,
      maxLineLength: resolved.readMaxLineLength,
      maxBytes: resolved.readMaxBytes,
      streamMinSize: resolved.readStreamMinSize,
    })
  }
  // read_image is composition-conditional: without a mounted attachment store
  // the deployment cannot durably commit image bytes, so the tool never
  // registers; the execute body keeps a defensive re-check for direct callers.
  if (resolved.readImage) {
    ctx.inject(['attachments'], (imageCtx) => {
      applyReadImageTool(imageCtx)
    })
  }
  // generate_image is always available: it uses the LLM loopback gateway
  // with the admin's OpenRouter API key, and cost is debited from the tenant's quota.
  applyGenerateImageTool(ctx)
  // One escalation API shared by both mutating tools: advertisement gating,
  // per-call policy resolution, and denial-marker mapping, all keyed off whether
  // the mounted ctx.fs confines (ctx.fs.sandboxMode).
  if (resolved.write || resolved.edit) {
    const sandbox = new FsSandboxController(ctx)
    if (resolved.write) applyWriteTool(ctx, sandbox)
    if (resolved.edit) applyEditTool(ctx, sandbox)
  }
}
