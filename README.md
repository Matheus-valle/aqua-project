# 🌊 Oceano Vivo — ABZÛ 

Experiência 3D imersiva em tela cheia construída com **React 19 + TypeScript + React Three Fiber + Drei + Three.js**.

## ✨ O que mudou

- Canvas 2D pixelado removido — agora é uma cena 3D declarativa em R3F, fullscreen `100vw × 100vh`, sem HUD arcade.
- **Fim da caixa flutuante**: skydome subaquático de 130 unidades com gradiente turquesa claro → azul abissal escuro, `fogExp2` denso combinado com a cor do horizonte e terreno visual de 180 unidades que desaparece na névoa.
- **Superfície oceânica realista**: quatro trens de onda com normais analíticas no vertex shader, janela de Snell vista de baixo, especular do sol, caustics de refração e fade radial — ciano/turquesa vistos de baixo, sem borda reta.
- **Terreno orgânico**: dunas, vales, ripples e cânions proceduralmente esculpidos; caustics injetadas no próprio material do solo (sem plano sobreposto, sem z-fighting); falésias e bancos de corais ancorados em `groundY(x, z)`.
- **Ruínas reconstruídas** (`SubmergedRuins.tsx`): bases exatamente no terreno com fundação enterrada `0.35–0.4`, colunas estriadas inteiras e partidas com núcleo exposto, arquitraves, arcos monumentais em blocos de pedra, escadarias/terraços com dunas de areia, totens estilizados, incrustações douradas/turquesa com brilho suave e `polygonOffset`, limo, cracas, corais e algas nas frestas. Normais, bounding boxes e bounding spheres recalculados em toda peça.
- **Touro de mármore branco central** (`bull.ts` + `BullStatue.tsx`): estátua imponente em mármore polido com veios frios, ampliada por `MONUMENT_SCALE`, sobre pedestal de ruínas com escadaria circular — cabeça erguida, chifres curvados, musculatura esculpida, incrustações discretas de ouro/turquesa, corais e cracas. Bounding box/sphere e raio de colisão escalados junto: peixes, tubarões, caranguejos e camarões contornam o monumento.
- **Golfinhos anatômicos** (`SeaCreatures.tsx`): corpo em 12 anéis com coloração dorsal/ventral por vértice, melão, rostro com mandíbula separada, olhos com soquete e brilho, blowhole, nadadeira dorsal falcada, peitorais curvas e fluke bifurcado com batimento suave.
- **Animais orgânicos (sem primitivas simples)**: corpos em anéis subdivididos, nadadeiras extrudadas, tubos e lathes com `computeVertexNormals()`, olhos expressivos, padrões procedurais (escamas, listras, degradês), especular úmido e rim light. Caudal, peitorais e dorsal usam máscara por vértice com defasagem de fase raiz→ponta e amplitude/frequência amortecidas pela velocidade (`Math.min(delta, 0.05)`).
- **Física de fundo definitiva**: caranguejos e camarões ancorados em `getTerrainHeight(x, z)` com offset das patas, orientação por `Quaternion.slerp` até a normal do terreno com inclinação máxima limitada, repulsão suave e correção dura contra pedestal/rochas/coral, Y travado no relevo.
- **Espécies**: 5 cardumes (palhaço, cirurgião-patela, anjo, borboleta e **néons iridescentes**), 2 **tubarões** de nado lento na meia-água, 3 golfinhos, 2 arraias-manta, 2 tartarugas, 10 águas-vivas, **caranguejos com 8 patas bi-articuladas, olhos pedunculados e pinças que abrem/fecham**, **camarões segmentados translúcidos** com listras, antenas longas, patinhas natatórias e nado em impulsos, além de estrelas e conchas no fundo.
- **Animações fluidas**: ondulação senoidal progressiva ao longo da coluna (cabeça quase parada, amplitude crescente até a cauda) sincronizada à velocidade real; marcha alternada dos caranguejos com correção do pé no terreno; caudas e nadadeiras sem distorção de vértices.
- **Estabilidade blindada**: `Math.min(delta, 0.05)`, proteção contra vetores nulos/`NaN`/`Infinity`, headings persistentes (nunca `lookAt` com vetor nulo ou colinear a Y), forças suaves de contenção entre terreno e superfície, desvio de ruínas/corais/bordas e fail-safe com retorno suave ao centro. Geometrias animadas com `frustumCulled={false}` e bounding spheres recalculadas.
- **Bolhas**: colunas que nascem no assoalho dos recifes e ocasionalmente de peixes, com brilho especular, tamanhos variados, wobble horizontal e reinício na superfície — além das bolhas de clique.
- Interação: clique na água libera comida/bolhas; clique em um animal faz a câmera segui-lo.
- HUD glassmorphism com som ambiente procedural (Web Audio API), modo Cinema e foco aleatório.
- Cleanup explícito de geometrias e materiais; PRNG determinístico `mulberry32` para cenas estáveis; instanced mesh por espécie.

## 🚀 Executar

```bash
npm install
npm run dev
# http://localhost:5173
```

Build de produção:

```bash
npm run build
```

> No Windows, se o npm bloquear scripts, use o prefixo:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;`

## 📁 Estrutura

```
src/
├── App.tsx
├── main.tsx
├── components/
│   ├── AquariumCanvas.tsx   # Canvas, câmera, luzes, névoa, OrbitControls, pós-processamento
│   ├── OceanEnvironment.tsx # Areia, cáusticas, rochas, recife, kelp, anêmonas, perímetro
│   ├── SubmergedRuins.tsx   # Ruínas: colunas, arcos, arquitraves, terraços, totens, incrustações
│   ├── MarineLife.tsx       # Cardumes Boids, néons, tubarões e tartarugas
│   ├── SeaCreatures.tsx     # Golfinhos, arraias, águas-vivas e integração da fauna
│   ├── Crabs.tsx            # Caranguejos articulados no relevo
│   ├── Shrimp.tsx           # Camarões segmentados em impulsos
│   ├── WaterEffects.tsx     # God rays, superfície, plâncton, bolhas, colunas de bolhas e comida
│   └── HudOverlay.tsx       # HUD glassmorphism
├── hooks/useAmbientAudio.ts
├── scene/
│   ├── terrain.ts           # Altura, normal, fundação e contenção da coluna d'água
│   ├── obstacles.ts         # Sítios compartilhados, colisão e steering de desvio
│   ├── organic.ts           # Construtores de malhas orgânicas
│   ├── types.ts
│   └── random.ts
└── styles/index.css
```
