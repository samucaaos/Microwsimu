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

## Biblioteca de magnetrons
Lista de seleção no grupo "Magnetron". Por ora só o **YJ1600 = Toshiba E3327** (CW, 2460 MHz, anodo a água,
eletroímã integrado), com dados dos datasheets Toshiba E200012-L935 (22/10/2020) e National Electronics/Richardson
YJ1600 (Rev. 6/2019): Va 7,2 kV (máx. 8), Ia 100–1150 mA, entrada DC ≤ 9 kW, RF 6 kW típico a 1150 mA com
circulador (garantido ≥ 4,3 kW a 950 mA e ≥ 5,5 kW a 1150 mA com VSWR 2,5 sink), 2450–2470 MHz, filamento
5 V/10 s de pré-aquecimento (33 A) e tensão de operação conforme Fig. 4, eletroímã −2 a 0 A, água ≥ 2,5 L/min
(≤ 0,49 MPa, saída ≤ 65 °C aberto / 75 °C fechado), VSWR de carga ≤ 4:1 absoluto.
A potência disponível segue a corrente de anodo (P ∝ Ia a Va constante). Pulling/pushing de frequência não consta
nos datasheets e não é modelado. Novos modelos: adicionar uma entrada em `MAGNETRONS` (src/mw.js).

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
