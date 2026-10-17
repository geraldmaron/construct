import { closed, str } from '../definition.ts';
import {
  contextIndexStatus,
  rebuildContextIndex,
  configureEmbeddings,
  type EmbeddingIdentity,
  putEmbeddings,
} from '../../context/retrieval.ts';
import { define } from './shared.ts';

export const contextIndex = define<Record<string, unknown>, unknown>({
  name: 'context_index',
  title: 'Context index',
  surface: 'interactive',
  readOnly: false,
  description:
    'Inspect or rebuild the derived local index. Explicitly enable or disable supplied embeddings; configure resets prior vectors. Record vectors for returned embeddingRef and exact passage fingerprints. This tool invokes no model, download or service.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Index operation.', enum: ['status', 'rebuild', 'configure', 'put_vectors', 'disable'] },
      model: { type: 'string', description: 'Text value.' },
      dimensions: { type: 'number', description: 'Finite numeric value.' },
      items: {
        type: 'array',
        description: 'Vectors of admitted documents.',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Text value.' },
            digest: { type: 'string', description: 'Text value.' },
            vector: {
              type: 'array',
              description: 'Embedding dimensions.',
              items: { type: 'number', description: 'Finite numeric value.' },
            },
          },
          required: ['ref', 'digest', 'vector'],
          additionalProperties: false,
        },
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    str(raw, 'action', { oneOf: ['status', 'rebuild', 'configure', 'put_vectors', 'disable'] });
    return raw;
  },
  run(ctx, input) {
    if (input.action === 'status') return contextIndexStatus(ctx.store);
    if (input.action === 'rebuild') return rebuildContextIndex(ctx.store, ctx.now());
    if (input.action === 'disable') return configureEmbeddings(ctx.store, null);
    const identity = { model: input.model, dimensions: input.dimensions } as EmbeddingIdentity;
    if (input.action === 'configure') return configureEmbeddings(ctx.store, identity);
    return putEmbeddings(ctx.store, { ...identity, items: input.items } as Parameters<typeof putEmbeddings>[1], ctx.now());
  },
});
