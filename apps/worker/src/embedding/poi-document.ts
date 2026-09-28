import { createHash } from 'node:crypto';

import type { EmbeddingDocument, PoiEmbeddingSource } from './types.js';

const DOCUMENT_SCHEMA = 'poi-search-document/v1';

function stableText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * Builds a language-specific, versioned text representation. Field labels and
 * ordering are deliberately fixed: changing either is a document schema change
 * and should trigger an intentional re-index.
 */
export function buildPoiDocumentContent(source: PoiEmbeddingSource): string {
  return [
    `schema: ${DOCUMENT_SCHEMA}`,
    `locale: ${source.locale}`,
    `name: ${stableText(source.name)}`,
    `category: ${stableText(source.category)}`,
    `summary: ${stableText(source.shortDescription)}`,
    `description: ${stableText(source.longDescription)}`,
  ].join('\n');
}

export function hashEmbeddingContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function buildPoiEmbeddingDocument(
  source: PoiEmbeddingSource,
): EmbeddingDocument {
  const content = buildPoiDocumentContent(source);
  return {
    entityType: 'poi',
    entityId: source.id,
    locale: source.locale,
    content,
    contentHash: hashEmbeddingContent(content),
  };
}
