const COMBINING_MARKS = /\p{M}+/gu;
const NON_WORD = /[^a-z0-9]+/g;

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(NON_WORD, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s/g, '');
  if (compact.length < 2) return new Set(compact ? [compact] : []);
  return new Set(
    Array.from({ length: compact.length - 1 }, (_, index) =>
      compact.slice(index, index + 2),
    ),
  );
}

export function lexicalScore(
  query: string,
  name: string,
  document: string,
): { exactName: boolean; normalizedName: boolean; textScore: number } {
  const rawQuery = query.trim().toLocaleLowerCase();
  const rawName = name.trim().toLocaleLowerCase();
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(name);
  const normalizedDocument = normalizeSearchText(document);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const documentTokens = new Set(normalizedDocument.split(' ').filter(Boolean));
  const tokenRecall =
    queryTokens.length === 0
      ? 0
      : queryTokens.filter((token) => documentTokens.has(token)).length /
        queryTokens.length;
  const queryBigrams = bigrams(normalizedQuery);
  const nameBigrams = bigrams(normalizedName);
  const intersection = [...queryBigrams].filter((value) =>
    nameBigrams.has(value),
  ).length;
  const fuzzyName =
    queryBigrams.size + nameBigrams.size === 0
      ? 0
      : (2 * intersection) / (queryBigrams.size + nameBigrams.size);
  const exactName = rawQuery === rawName;
  const accentInsensitiveName = normalizedQuery === normalizedName;
  return {
    exactName,
    normalizedName: accentInsensitiveName,
    textScore:
      (exactName ? 4 : accentInsensitiveName ? 3 : 0) +
      tokenRecall * 1.5 +
      fuzzyName,
  };
}

// Function words and meta words ("category", "POI") that match nearly every
// record. Compared after normalizeSearchText (lower case, no diacritics).
const STOPWORDS = new Set([
  // Vietnamese
  'cho',
  'cua',
  'va',
  'la',
  'o',
  'noi',
  'cac',
  'nhung',
  'mot',
  'de',
  'den',
  'toi',
  'muon',
  'xem',
  'ca',
  'voi',
  'tai',
  'tu',
  'nay',
  'do',
  'nao',
  'gi',
  // English
  'a',
  'an',
  'the',
  'for',
  'of',
  'to',
  'in',
  'on',
  'at',
  'and',
  'or',
  'is',
  'are',
  'how',
  'what',
  'where',
  'i',
  'want',
  'see',
  'place',
  // Meta words about the catalogue itself
  'category',
  'categories',
  'poi',
  'pois',
]);

/**
 * Significant query terms for OR-style matching. A record matches when it
 * contains at least `minMatch` of them (half, rounded up), so a natural
 * sentence still finds the right POI while a query that only shares one common
 * word with the catalogue ("nhà hàng pizza" vs "Nhà Khám Phá") returns nothing.
 * When every word is a stopword the plain tokens are used instead.
 */
export function searchTerms(query: string): {
  terms: string[];
  minMatch: number;
} {
  const tokens = [...new Set(normalizeSearchText(query).split(' '))].filter(
    Boolean,
  );
  const significant = tokens.filter((token) => !STOPWORDS.has(token));
  const terms = significant.length > 0 ? significant : tokens;
  return { terms, minMatch: Math.max(1, Math.ceil(terms.length / 2)) };
}
