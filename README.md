# Microwsimu — simulador de aquecimento industrial por micro-ondas

Magnetron 6 kW / 2,45 GHz → launcher WR340 → guia 1 → isolador de 3 vias (circulador + water load)
→ guia 2 → transição WR340/coaxial → tubo coaxial → ressonador coaxial com amostra na ponta.

## Uso
Abra `index.html` no navegador (sem instalação). Todos os blocos têm parâmetros editáveis
(comprimentos, backshort/probe do launcher e da transição, dimensões do guia e do coax, perdas do
isolador, ressonador e propriedades da amostra). Abas: varredura de frequência, varredura de
qualquer parâmetro (ex.: comprimento dos guias), aquecimento no tempo e balanço de potência.
Botões do ressonador: **Sintonizar comprimento** e **Acoplamento crítico**.

Testes do motor: `node test/test.js`.

## Modelo (src/mw.js)
- Cascata de matrizes S em regime permanente; o circulador é resolvido como rede de 3 portas com
  a water load na porta 3, incluindo a reflexão múltipla com a fonte (pulling não modelado).
- Guia: TE10, atenuação por condutor (Al por padrão). Coax: TEM, perda por efeito pelicular.
- Isolador: perda de inserção, isolação e RL finitos, S passiva.
- Ressonador: stub coaxial curto-circuitado + gap capacitivo com amostra (ε', tan δ dependentes de T),
  tap ideal n:1. Aquecimento: balanço térmico com realimentação (a amostra desintoniza ao aquecer).
- Launcher, transição e acoplamento são **modelos empíricos de 1ª ordem**: servem para sensibilidade
  e dimensionamento preliminar; valide com CST/HFSS ou medição.
- O balanço de potência fecha a ~1e-16 (verificado em casos aleatórios).
