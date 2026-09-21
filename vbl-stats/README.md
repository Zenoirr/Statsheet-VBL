# VBL Stats — Painel de Partida

Painel de estatísticas de vôlei por set, com ratings por função, substituições,
histórico local de partidas e envio de feedback.

## O que mudou nesta versão (redesign)

- **Estrutura em 3 arquivos** (`index.html`, `css/styles.css`, `js/app.js`) no lugar de um único
  HTML gigante com CSS e JS duplicados — mais leve, mais rápido e mais fácil de manter.
- **Layout novo**: navegação lateral (sidebar) em vez de abas no topo; no celular vira um menu
  deslizante.
- **Paleta e tipografia próprias**: fundo grafite quente, laranja "quadra" como cor de ação e
  verde-água como cor de apoio; Barlow Condensed para números/placar e Inter para o restante.
- **Fundo animado sutil**: dois brilhos em gradiente que se movem lentamente atrás do conteúdo,
  sem prejudicar a performance (respeita `prefers-reduced-motion`).
- **Abas "Treinos" e "Times" removidas**, como pedido — o foco fica na partida em si (Set 1, 2, 3,
  Final e Histórico).
- **Todas as funcionalidades anteriores foram mantidas**: cálculo de rating por função, eficiência,
  consistência, ponto fraco da equipe, substituições com preservação de estatísticas por set,
  histórico de partidas salvo no navegador, formulário de feedback (Discord webhook) e changelog.

## Estrutura de arquivos

```
vbl-stats/
├── index.html        → estrutura da página
├── css/styles.css     → todo o visual (tokens de cor, layout, animações, responsivo)
├── js/app.js          → toda a lógica (cálculos, estado, renderização, eventos)
└── README.md
```

## Como publicar no GitHub Pages

1. Crie um repositório novo (ou use o atual) e suba estes arquivos mantendo a mesma estrutura de
   pastas.
2. Em **Settings → Pages**, escolha a branch `main` e a pasta `/root`.
3. Pronto — o site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## Observações

- Os dados (placar, estatísticas, histórico) ficam salvos no `localStorage` do navegador de quem
  está usando — não há backend. Isso significa que o histórico é por navegador/dispositivo, exatamente
  como antes.
- O webhook do Discord usado no formulário de feedback foi mantido igual ao da versão anterior.
- Para trocar as cores, edite as variáveis no topo de `css/styles.css` (bloco `:root`).
