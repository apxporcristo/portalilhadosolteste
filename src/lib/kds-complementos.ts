/**
 * Parses the raw complementos string from kds_orders and extracts
 * only the selected values (removing category names).
 *
 * Input formats handled:
 *   "CATEGORIA1: valor1, CATEGORIA2: valor2"
 *   "CATEGORIA1: valor1 | CATEGORIA2: valor2"
 *   "valor1, valor2" (no category prefix)
 *   JSON array: [{"categoria":"X","nome":"Y"}, ...]
 */
export function parseComplementos(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];

  // Try JSON first (array of objects with nome/name)
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const items = parsed
        .map((item: any) => {
          const value = item.nome || item.name || item.descricao || '';
          return cleanComplementoValue(value);
        })
        .filter(Boolean);
      return [...new Set(items)];
    }
  } catch { /* not JSON */ }

  // Split by common separators: | or ,
  // Each segment may be "CATEGORY: VALUE" or just "VALUE"
  const segments = raw
    .split(/[|,]/)
    .map(s => s.trim())
    .filter(Boolean);

  const result = segments.map(seg => {
    // If contains ":", take only the part after the last ":"
    const colonIdx = seg.indexOf(':');
    if (colonIdx !== -1) {
      return cleanComplementoValue(seg.substring(colonIdx + 1).trim());
    }
    return cleanComplementoValue(seg.trim());
  }).filter(Boolean);

  // Deduplicate
  return [...new Set(result)];
}

/**
 * Strips known category prefixes from a complemento value.
 * E.g. "COMPL ARROZ OU BAIÃO" → "" (it's a category name, not a value)
 * But "Arroz" → "Arroz" (it's an actual selection)
 */
function cleanComplementoValue(value: string): string {
  if (!value) return '';

  // Strip "COMPL " or "COMPL. " prefix — these are category labels, not selections
  // If the entire value starts with "COMPL" and looks like a category name, skip it
  const upper = value.toUpperCase().trim();
  if (upper.startsWith('COMPL ') || upper.startsWith('COMPL.') || upper === 'COMPL') {
    return '';
  }

  return value.trim();
}

/**
 * Extracts only the clean product name, stripping any appended complementos.
 * Handles legacy format: "Produto | CATEGORIA: valor, ..."
 */
export function cleanProdutoNome(nome: string | null | undefined): string {
  if (!nome) return '';
  const pipeIdx = nome.indexOf(' | ');
  if (pipeIdx !== -1) {
    return nome.substring(0, pipeIdx).trim();
  }
  return nome.trim();
}

/**
 * Extracts the size/tamanho from complementos if present.
 * Looks for common size keywords.
 */
export function extractTamanho(raw: string | null | undefined): string | null {
  const items = parseComplementos(raw);
  const sizeKeywords = ['pequeno', 'pequena', 'médio', 'média', 'medio', 'media', 'grande', 'p', 'm', 'g', 'gg', 'individual', 'família', 'familia'];
  for (const item of items) {
    if (sizeKeywords.includes(item.toLowerCase())) return item;
  }
  return null;
}

/**
 * Formats complementos for speech synthesis — only product name + size.
 */
export function complementosParaVoz(raw: string | null | undefined): string {
  const tamanho = extractTamanho(raw);
  return tamanho ? `Tamanho ${tamanho}` : '';
}
