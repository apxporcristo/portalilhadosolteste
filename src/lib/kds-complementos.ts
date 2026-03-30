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
      return parsed
        .map((item: any) => item.nome || item.name || item.descricao || '')
        .filter(Boolean);
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
      return seg.substring(colonIdx + 1).trim();
    }
    return seg.trim();
  }).filter(Boolean);

  // Deduplicate
  return [...new Set(result)];
}

/**
 * Formats complementos for speech synthesis (plain text list).
 */
export function complementosParaVoz(raw: string | null | undefined): string {
  const items = parseComplementos(raw);
  if (items.length === 0) return '';
  return items.join(', ');
}
