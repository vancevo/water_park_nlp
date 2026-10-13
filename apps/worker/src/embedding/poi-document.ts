import { createHash } from 'node:crypto';

import type { EmbeddingDocument, PoiEmbeddingSource } from './types.js';

const DOCUMENT_SCHEMA = 'poi-search-document/v2';

function stableText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function stableList(values: readonly string[]): string {
  return values.map(stableText).filter(Boolean).join(' | ');
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
    `aliases: ${stableList(source.aliases)}`,
    `activities: ${stableList(source.activities)}`,
    `attributes: ${stableList(source.attributes)}`,
    `audiences: ${stableList(source.audiences)}`,
    `intent phrases: ${stableList(source.intentPhrases)}`,
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
