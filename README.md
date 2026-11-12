# Alta — Slides em 300 dpi

Extensão para Chrome e Edge que exporta **todos os slides de uma apresentação do Google Slides como imagens**. O padrão é **300 dpi**, **2× o tamanho do slide**, PNG, tudo em um único ZIP.

O PDF da apresentação é baixado pelo próprio mecanismo de exportação do Google Slides e rasterizado no seu navegador. Nada é enviado para servidores de terceiros.

---

## Instalar

A extensão não está publicada na Chrome Web Store. Para usar agora:

1. Baixe esta pasta (ou o ZIP em `dist/`) e descompacte, se necessário.
2. Abra `chrome://extensions` no Chrome (ou `edge://extensions` no Edge).
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** / **Load unpacked**.
5. Selecione a pasta que contém o `manifest.json` (a pasta `alta-slides`, não a pasta `dist`).
6. Opcional: clique no ícone de peça de quebra-cabeça e fixe a **Alta** na barra.

Requisitos: Chrome/Edge 110 ou superior, no computador. É preciso estar conectado a uma conta Google com acesso à apresentação e permissão para baixá-la.

Para atualizar depois, substitua os arquivos da pasta e clique em **Recarregar** em `chrome://extensions`.

---

## Usar

1. Abra a apresentação no editor do Google Slides. A URL deve ser parecida com `docs.google.com/presentation/d/…/edit`.
2. Clique no ícone da **Alta**.
3. Escolha a resolução, o tamanho, o formato e se quer um ZIP.
4. Clique em **Exportar apresentação**.
5. Uma nova aba mostra o progresso e a prévia dos slides. **Mantenha essa aba visível até o fim.**
6. O download começa automaticamente. No modo ZIP, sai um arquivo como `Plano 2027 - 300dpi 2x.zip`; sem ZIP, o Chrome cria uma subpasta em Downloads com um arquivo por slide.

Os ajustes ficam salvos para a próxima exportação.

> **Importante:** o Chrome pausa animações e desenho de abas em segundo plano. Se você trocar de aba, a renderização fica parada até voltar. O progresso não é perdido.

### O que “300 dpi e 2×” significam

Um slide widescreen padrão do Google Slides mede 10 × 5,625 polegadas.

| Ajuste | Pixels por slide | Tamanho de impressão a 300 dpi |
| --- | --- | --- |
| 300 dpi · 1× | 3.000 × 1.688 px | 25,4 × 14,3 cm |
| **300 dpi · 2× (padrão)** | **6.000 × 3.375 px** | **50,8 × 28,6 cm** |
| 300 dpi · 3× | 9.000 × 5.063 px | 76,2 × 42,9 cm |
| 600 dpi · 2× | 12.000 × 6.750 px | 50,8 × 28,6 cm |

A conta é feita a partir do tamanho real da página do PDF, não de uma suposição de 16:9. Um slide 4:3 de 10 × 7,5 pol, por exemplo, sai com 6.000 × 4.500 px.

O arquivo também recebe metadados de densidade: bloco `pHYs` no PNG e segmento `APP0/JFIF` no JPEG. Assim, Photoshop, Affinity, Preview e outros programas mostram 300 dpi e o tamanho de impressão esperado.

### Ajustes disponíveis

- **Resolução:** 150, 300 ou 600 dpi.
- **Tamanho:** 1×, 2× ou 3× o slide original.
- **Formato:** PNG sem perdas (recomendado para texto) ou JPG mais leve (qualidade 92).
- **Juntar em um ZIP:** um único download. Desligado, cada slide vira um download separado dentro de uma subpasta com o nome da apresentação.

---

## Como funciona

1. O popup identifica a apresentação, o título e a conta Google usada na URL (`/u/1/d/…`).
2. A tela de exportação baixa o PDF gerado pelo próprio Google Slides — o mesmo arquivo de **Arquivo → Fazer download → PDF**.
3. O PDF é aberto localmente com o [PDF.js](https://mozilla.github.io/pdf.js/), que preserva o texto e os vetores.
4. Cada página é desenhada em um canvas no tamanho final calculado, com fundo branco.
5. O PNG/JPEG é gerado e recebe os metadados de dpi.
6. No modo ZIP, as imagens são agrupadas sem recomprimir (elas já estão comprimidas). O ZIP é baixado.

Como o PDF é vetorial, o resultado tem muito mais qualidade do que uma captura de tela ou o download de PNG do próprio Slides.

### Contas múltiplas

Se a apresentação estiver aberta em uma conta secundária (`/u/1/`, `/u/2/`), a extensão usa o mesmo índice `authuser` na exportação. Isso evita baixar a apresentação errada quando há mais de uma conta conectada no navegador.

### Plano B

Se o download direto do PDF for bloqueado, a tela oferece **Buscar pela aba do Slides**. A extensão pede o arquivo ao próprio conteúdo da aba aberta, usando a sessão daquela página. Esse modo alternativo tem um limite de 32 MB por causa do tamanho das mensagens do Chrome; o modo direto não tem esse limite.

---

## Privacidade

- A extensão faz requisições somente para `docs.google.com` e para o endereço temporário `*.googleusercontent.com` para onde o Google redireciona o PDF.
- Não há analytics, rastreamento, servidor próprio ou biblioteca remota.
- O PDF e as imagens ficam na memória do navegador. Os arquivos são salvos pelo gerenciador de downloads do Chrome.
- O código do PDF.js, as fontes e todo o resto são empacotados localmente.

A permissão para `googleusercontent.com` é necessária porque o Google responde à exportação com um redirecionamento assinado para esse domínio. Sem ela, o Chrome bloqueia a leitura do PDF por CORS.

---

## Permissões

| Permissão | Para quê |
| --- | --- |
| `downloads` | Salvar as imagens e o ZIP em Downloads. |
| `storage` | Guardar preferências e o trabalho de exportação entre o popup e a aba de renderização. |
| `scripting` | Injetar o leitor de PDF na aba do Slides somente quando o modo alternativo é necessário. |
| `https://docs.google.com/*` | Ler a URL/título da apresentação e baixar o PDF exportado. |
| `https://*.googleusercontent.com/*` | Ler o PDF depois do redirecionamento assinado do Google. |

A extensão não pede acesso a todas as abas nem ao histórico.

---

## Limitações e soluções de problemas

**“O Google não liberou o arquivo.”**
Confira se você ainda está conectado e se a conta aberta tem acesso à apresentação. Recarregue a aba do Slides. Se a apresentação for de uma organização, o administrador pode ter desativado downloads. O botão **Buscar pela aba do Slides** pode ajudar em sessões recém-restauradas.

**“A aba da apresentação não respondeu.”**
A aba original foi fechada, navegou para outro endereço ou ainda está carregando. Abra a apresentação novamente e recarregue a página.

**O popup diz “Abra uma apresentação.”**
Ele só funciona em uma apresentação editável ou acessível em `docs.google.com/presentation/d/…`. Links publicados no formato `/presentation/d/e/…/pub` não revelam o arquivo original; abra a versão normal do deck.

**A renderização parou no meio.**
Volte para a aba da Alta. O Chrome pausa o desenho de abas em segundo plano. Se ela foi fechada, comece de novo pelo popup.

**O ZIP passou de 4 GB.**
O formato ZIP clássico não passa desse limite. Use **Baixar imagens separadas** na mensagem de erro.

**Um slide customizado gigante foi reduzido.**
O Chrome limita o tamanho do canvas (a extensão usa no máximo 16.000 px por lado e 120 megapixels). Quando isso acontece, a tela avisa e informa o dpi efetivo. Para slides muito grandes, reduza a escala ou o dpi.

**A apresentação tem vídeo, animação ou transição.**
A exportação é estática, como o PDF do Google Slides. O que não aparece no PDF também não aparece na imagem.

**A exportação demora.**
Cada slide é rasterizado em alta resolução e codificado em PNG. Decks com muitas fotos podem levar alguns minutos. O progresso e a prévia mostram o andamento. Não feche a aba.

**Não é afiliada ao Google.**
Google Slides é uma marca do Google. Esta é uma ferramenta independente que usa o recurso de exportação em PDF da própria conta do usuário.

---

## Desenvolvimento

Estrutura principal:

```
alta-slides/
├── manifest.json          MV3
├── popup.html/css/js      configurações
├── renderer.html/css/js   progresso, preview, download
├── content.js             plano B de download pela aba
├── lib/                   ZIP, CRC32, pHYs/JFIF e nomes
├── vendor/                PDF.js 3.11.174 + cmaps + fontes padrão
├── assets/                ícones e fontes Archivo/Newsreader
├── test/                  testes unitários e PDFs de amostra
└── dev/                   previews e testes de integração
```

Rodar os testes:

```bash
npm test
```

Não há dependências npm. Os testes usam apenas o Node (18+) e o `unzip` do sistema.

Testes úteis de desenvolvimento (servidor local na porta 8765):

```bash
python3 -m http.server 8765
# popup:      http://localhost:8765/dev/preview-popup.html
# vazio:      http://localhost:8765/dev/preview-popup.html?empty=1
# exportação: http://localhost:8765/dev/preview-renderer.html?job=preview
# PDF.js:     http://localhost:8765/dev/render-test.html
```

O preview da exportação usa um mock de `chrome.*`, um PDF de amostra e não salva downloads de verdade.

Teste da extensão real via CDP (carrega o manifesto, abre o popup, baixa um PDF público, renderiza e cancela):

```bash
node dev/extension-test.mjs
```

Teste ponta a ponta com um PDF de amostra interceptado (gera o ZIP, extrai e confere dimensões e dpi dos PNGs; use `jpg` como argumento para testar JPEG):

```bash
node dev/e2e-test.mjs
node dev/e2e-test.mjs jpg
```

A partir do Chrome 137, o Chrome oficial não aceita mais `--load-extension`. Os scripts usam o comando CDP `Extensions.loadUnpacked`, disponível nas versões recentes.

> Nos testes automatizados via CDP, o Chrome no macOS pode renomear downloads para UUIDs por causa de um bug conhecido do `Browser.setDownloadBehavior`; isso não acontece no uso normal da extensão e não afeta o conteúdo dos arquivos.

Gerar o ZIP de distribuição:

```bash
npm run zip
```

O ZIP fica em `dist/alta-slides-1.0.0.zip` com uma pasta `alta-slides/` na raiz.

---

## Licenças

- Código original: [MIT](LICENSE).
- PDF.js: Apache 2.0. Licença em `vendor/LICENSE-pdfjs`.
- Archivo e Newsreader: SIL Open Font License 1.1. Licenças em `assets/fonts/`.
