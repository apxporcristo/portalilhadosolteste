import { parseComplementos, cleanProdutoNome } from './kds-complementos';

export interface KdsDisplayInput {
  produto_nome: string;
  quantidade: number;
  complementos: string | null;
  observacao: string | null;
  nome_atendente: string | null;
}

export interface KdsDisplayOutput {
  produtoNome: string;
  quantidadeVisivel: string | null;
  complementosFormatados: string[];
  observacaoValida: string | null;
  textoFalaKds: string;
}

/**
 * Central function to normalize KDS order display data.
 * Used by both the card rendering and the speech synthesis.
 */
export function normalizeKdsDisplay(input: KdsDisplayInput): KdsDisplayOutput {
  const produtoNome = cleanProdutoNome(input.produto_nome);

  // Quantity: only visible when > 1
  const quantidadeVisivel = input.quantidade > 1 ? `x${input.quantidade}` : null;

  // Complementos: parsed and cleaned (category names removed)
  const complementosFormatados = parseComplementos(input.complementos);

  // Observação: only if non-empty after trim
  const obsRaw = input.observacao?.trim();
  const observacaoValida = obsRaw && obsRaw.length > 0 ? obsRaw : null;

  // Build speech text
  const parts: string[] = ['Novo pedido.'];

  // Quantity in speech only if > 1
  if (input.quantidade > 1) {
    parts.push(`${input.quantidade} unidades.`);
  }

  parts.push(`${produtoNome}.`);

  if (complementosFormatados.length > 0) {
    parts.push(`Complementos: ${complementosFormatados.join(', ')}.`);
  }

  if (input.nome_atendente) {
    parts.push(`Atendente: ${input.nome_atendente}.`);
  }

  if (observacaoValida) {
    parts.push(`Observação: ${observacaoValida}.`);
  }

  const textoFalaKds = parts.join(' ');

  return {
    produtoNome,
    quantidadeVisivel,
    complementosFormatados,
    observacaoValida,
    textoFalaKds,
  };
}
