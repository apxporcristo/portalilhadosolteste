

## Plano: Mover Impressora para ao lado de Forma de Venda

### Alteração única em `src/pages/FichasAdmin.tsx`

Reorganizar o layout do formulário de produto no modal:

**Antes (linhas 698-727):**
- Impressora está sozinha em um bloco acima
- Forma de venda + Valor por kg estão em um `grid grid-cols-2` abaixo

**Depois:**
- Remover o bloco da Impressora (linhas 698-709) da posição atual
- Criar um novo `grid grid-cols-2` (ou `grid-cols-3` se por_peso) contendo: **Forma de venda** | **Impressora** na mesma linha
- Se `forma_venda === 'por_peso'`, o campo **Valor por kg** aparece abaixo

Layout resultante:
```text
[Forma de venda ▼]  [Impressora ▼]
[Valor por kg]  (só se por_peso)
```

### O que NÃO será alterado
Tudo o mais permanece intacto.

