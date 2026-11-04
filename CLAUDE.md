# Chat Pedro

Chat para um grupo de amigos, no estilo do Discord. O dono do projeto fala português: responda sempre
em português simples (a pessoa não é programadora), explique o que mudou no site, não no código.
Quando pedir "igual ao Discord", faça igual de verdade e no fim diga o que não deu para colocar e por quê.

## Onde roda
- Código no GitHub `tchicarelliantoniolli-coder/chat-pedro`, branch `main`. Pode commitar e dar push
  direto na `main` (o Render publica sozinho em alguns minutos): https://chat-pedro.onrender.com
- Render plano grátis: o servidor dorme depois de ~15 min parado e tem pouca memória e CPU.
  Mantenha o site leve (nada de bibliotecas grandes, imagens reduzidas no navegador antes de enviar).
- Supabase: projeto `yvdlkwdmhlvpjmesmkye` (região São Paulo). Tabelas: `profiles`, `servers`,
  `server_members`, `server_invites`, `server_bans`, `friendships` e `chat_kv` (chave/valor com o
  histórico, fotos, áudios e os dados de cada servidor em `srv:<id>:<nome>`). RLS ligado e nenhuma
  regra pública: só o servidor acessa, com a chave secreta. Mudança de tabela: use migração do Supabase.
  As chaves estrangeiras apagam em cascata quando a conta (`auth.users`) some.

## Segurança (regras do dono)
- NUNCA coloque segredos no código ou no repositório (é público). A `SUPABASE_SECRET_KEY` fica só no
  Render (Environment). Peça para a pessoa nunca colar essa chave no chat nem mostrar em print.
- A chave publicável (`sb_publishable_...`) pode ficar no código.
- Senhas e chaves só por variável de ambiente.

## Regras de design (pedidas pelo dono)
- Visual igual ao Discord: cores, tamanhos e fonte do Discord ("gg sans"), tokens no `:root` do
  `public/index.html` (tirados do CSS do discord.com com o REA). Só o tema escuro do Discord, sem outros temas.
- "CHAT PEDRO" fica no canto de cima à esquerda; o nome do servidor fica no topo da barra de canais.
- Ícones em vez de texto quando der; nada de colchetes [ ] para enfeite; minimalista.
- A call é ação principal (canais de voz na barra, botões de ligar na DM); nada de botões duplicados.
- Animações suaves como as do Discord.
- Sem GIFs e sem soundboard (o dono pediu para tirar).
- Só UMA reação por pessoa em cada mensagem (a nova substitui a antiga).
- Quem cria o servidor é o dono e moderador dele.
- Ícones novos: desenho próprio (não copiar SVG do Discord), no sprite `<symbol id="i-...">` do `index.html`.
  Os "cheios" do estilo Discord têm prefixo `u` (`i-umic`, `i-uhead`, `i-ucam`, `i-uscreen`, `i-ugear`...).

## Como copiar o Discord (REA)
- MELHOR FONTE: o dono salva o Discord logado no Chrome (Ctrl+S, "Página da Web, arquivo único" = `.mhtml`) e manda.
  Abra o `.mhtml` no Chromium do Playwright (`page.goto("file://...mhtml")`, bloqueando a rede) e meça com
  `getBoundingClientRect`/`getComputedStyle` achando cada peça pelo texto (cores vêm em `oklab(...)`: converta pintando
  num canvas). Medido assim (nov/2026): linha de canal 32px + 1px em cima/embaixo, a 8px da borda, ícone 20px, texto
  16/500; categoria 40px (16 + 24), 14/500; título do canal 16/500 com ícone 20px; busca 244x32, fundo
  `rgba(0,0,0,.12)`, borda `rgba(151,151,159,.2)`, lupa na direita; nome no topo 14/500 `#efeff1`; painel do usuário com
  borda `rgba(151,151,159,.04)`, nome 16/500, subtexto 12/500 `#abacb2`, botões `#abacb2` com 8px entre grupos e mudo
  `rgba(210,45,57,.12)`. NÃO tente logar na conta: o Discord pede captcha (não resolvemos) e o QR também cai no captcha.
- Sem o arquivo do dono, o app do Discord exige login; não dá para abrir as telas logado. O que funciona: abrir o discord.com
  num Chromium com `--remote-debugging-port` e usar `mcp__rea__inspect_web_page` (resultado grande vai para
  arquivo; ler com `jq`). Os CSS do app estão listados no HTML de `https://discord.com/app` (`/assets/*.css`)
  e os carregados depois estão no mapa `"<id>"===e?...".css"` do `web.*.js`. Baixe tudo e procure as regras
  pelo nome da classe (ex.: `panels_`, `audioButtonParent_`, `actionButtons_`, `wrapper_cb9592`).
- O CSS diz o padrão, mas algumas medidas o app muda pelo JavaScript: confira no JS antes de copiar. Ex.: a coluna da
  esquerda (servidores + canais) usa `--custom-guild-sidebar-width`, que o CSS deixa em 268px mas o JS põe em 375px ao
  abrir (arrastável de 264 a 432px). No Chat Pedro: `#side` = `--side-w` (303px), `#sideResize` em `settings.js`
  (`cp-sidew`). Tokens de cor: leia os valores finais na página aberta (`getComputedStyle` no `html`, que tem
  `theme-dark theme-darker visual-refresh`). Os nomes das classes vêm em mapas no JS (`C3:"panels__5e434"`); procure
  o hash e depois as regras com ele. A linha de canal da barra (classe de canal do servidor) não está nos CSS que dá
  para baixar sem login.
- Os textos oficiais em pt-BR ficam num pacote de mensagens (achar o chunk do `"pt-BR":()=>n.e("...")`
  ao lado do en-US e comparar as chaves).
- Fotos que o dono manda: meça cores e tamanhos com PIL (`getpixel`, recorte e amplie).
- Compare sempre com uma foto de tela do Chat Pedro tirada com Playwright antes e depois.

## Arquivos
- `server.js`: Express + Socket.io. API REST em `/api` (contas, `DELETE /api/me` exclui a conta, servidores,
  convites, DM, amigos, Descobrir, webhooks, prévia de links) e o tempo real. Cada servidor é um "ctx"
  separado (canais, histórico, call, poker, truco, cargos, emojis...). DM e DM em grupo são servidores com
  `dm = true`. O evento `profile` leva o status e `hideAct` (esconder "jogando poker", "na call").
- `db.js` (acesso ao Supabase), `storage.js` (salva o chat e os dados do servidor no `chat_kv`).
- Foto de perfil e foto do servidor: 256x256 em WebP (`squareImage` no `index.html`, reduz pela metade aos poucos para
  ficar nítida; ~15–40 KB). Fotos antigas de 48x48 só melhoram quando a pessoa manda de novo. Teste em `08-configuracoes`.
- Espaço do banco (500 MB grátis): fotos saem do navegador em WebP (JPEG se não der), no máximo 1 MB; áudio em mono a
  24 kbps; cada foto/áudio/arquivo fica numa linha `srv:<id>:media:<n>` (nunca dentro do histórico). Faxina no
  `server.js` (`trimStorage`, 1 min depois de ligar e a cada 30 min): chama a função do banco `chat_kv_trim_media`
  (migração `chat_kv_faxina_de_midias`); passando de `STORAGE_LIMIT_MB` (380) apaga as mídias mais antigas até
  `STORAGE_TARGET_MB` (300). Texto nunca é apagado pela faxina. Teste `14-espaco-do-banco` (usa a linha `// env:`
  do próprio teste, que o `run.sh` lê, para limites pequenos).
- `poker.js` e `truco.js` (servidor) e `public/poker.js`, `public/truco.js` (tela dos jogos).
- `blefe.js` (servidor) e `public/blefe.js` (tela): Mesa do Blefe, jogo NOSSO de blefe em 3D (estilo "Duvido" com
  revólver; não é cópia de nenhum jogo). De 2 a 6, baralho de 36 (8 por naipe + 4 coringas), 5 cartas, a mesa
  sorteia um naipe, joga 1 a 3 viradas ou grita DUVIDO; quem perde puxa o gatilho (6 espaços, 1 bala que só o
  servidor sabe). Porão com lâmpada; bonecos feitos no código com a foto de perfil no rosto, cor e chapéu
  (`chatpedro-blefe-look`), reações, boca mexe com a voz da call (`app.speakingNicks`, vem do `call.js`).
  A cabeça de cada boneco segue a câmera do jogador (`blefe:gaze`, até ~10/s, guardado em `seat.gaze`); quem nunca
  mexeu a câmera vira a cabeça para quem está jogando.
  three.js fica no `node_modules` e é servido em `/vendor/three` só quando abre a mesa; "modo leve" sem sombras.
  Testes `11-mesa-do-blefe` e `fuzz-blefe.js`.
- Tela cheia nos jogos: botão `.gfull` (`#actFull`, `#trFull`, `#blFull`) no topo de cada jogo; usa a tela cheia do
  navegador na seção do jogo e, onde não dá (iPhone), a classe `.gamefull` (ocupa a janela). Sai com Esc ou ao fechar o jogo.
- `public/index.html`: todo o CSS e o JS principal do chat (mensagens, canais, tópicos, fórum, markdown,
  emojis, membros, cartão de perfil, moderação, painel do usuário, tela de carregamento "Você sabia").
  As páginas das Configurações de usuário também estão no HTML (`#userSettings`, uma `.us-page` por seção).
- `public/boot.js`: login, 2 etapas, barra de servidores, menu do servidor, perfil (`window.ChatPedroAuth`:
  `updateProfile`, `deleteAccount`, `signOutOthers`, `exportData`...).
- Trocar de servidor NÃO recarrega a página (como no Discord; teste `20-trocar-servidor`): `ChatPedroAuth.goServer(id, opts)`
  faz `pushState` (o voltar do navegador funciona via `popstate`), chama `app.switchServer` (no `index.html`: guarda a tela
  de cada servidor em `srvCache` e mostra na hora quando volta; fecha janelas, painéis e jogos; módulos se ajeitam com
  `app.onSwitch(fn)`) e reconecta a MESMA conexão (`socket.disconnect().connect()`, o `handshake()` leva o servidor novo).
  O evento `me` chega a cada conexão: manda o status e chama `app.onJoin()` toda vez. Servidor fora da lista: recarrega.
  Nunca use `location.href = "/s/..."` para trocar de servidor; use `goServer` (com `{ answer: "voz" }` atende a chamada).
- Call com conexão própria (`cs` no `call.js`, `auth.call = true`; no servidor `socket.data.callOnly`, sala
  `<sala>:call`, só recebe o que é da call via `toCall`, sem jogos/mensagens): a call continua enquanto a pessoa olha
  outro servidor. Dentro do `call.js`, `socket` é um atalho para a conexão da call e `view` é a da tela; `here()` = a tela
  mostra o servidor da call (`#call` só aparece nele). `allMembers` = canais de voz da tela (barra), `callAll` = do
  servidor da call. "Voz conectada" mostra "canal / servidor" e clicar em `#vpWhere` volta para o servidor da call.
  Entrar em canal de voz de outro servidor sai da call atual. O status vai também pela conexão da call (`emitProfile`).
- `public/call.js`: call (WebRTC), canais de voz, palco, sensibilidade do microfone, assistir YouTube junto.
  Visual igual ao do Discord: fundo preto, só fotos redondas quando ninguém tem câmera (`#tiles.avmode`, com
  bolinha vermelha `.mbadge` de mudo), barra de botões em grupos (`.ctray`), menu "..." (`#moreBtn`) e
  Atividades (`app.actsMenu`: YouTube junto, Poker, Truco); painel "Voz conectada" com 3 botões
  (`#vpCam`, `#vpScreen`, `#vpAct`) e supressão de ruído (`#vpNoise`). `app.audio` serve os menus das setinhas.
  Volume de cada pessoa como no Discord: botão direito (ou segurar o dedo) na pessoa na lista do canal de voz ou no
  quadro da call abre `userMenu` ("Volume do usuário" 0–200%, "Silenciar" só para você, "Redefinir volume"); fica em
  `cp-vol-<nick>` e `cp-lmute-<nick>`. Acima de 100% (e no iPhone) o som passa por um GainNode (`boost`). Teste `12-volume-na-call`.
  Compartilhar tela como no Discord: vai com som (`getDisplayMedia` com áudio, sem o som da própria call); quem recebe
  toca o som da tela num `<audio>` separado da voz (`p.screenAudio`; o som é da tela quando o stream tem vídeo ou é o
  `m.screen` da pessoa, por isso o vídeo da tela é enviado antes do som). Tela nova de outra pessoa vira o quadro em
  destaque sozinha (`.tile.focus`, um por vez; clicar escolhe/volta para a grade; "AO VIVO" na lista também foca); com
  destaque a call cresce e os outros viram miniaturas de 64px embaixo. Teste `16-compartilhar-tela` (3 pessoas).
  Supressão de ruído no lugar do Krisp (o Discord usa o Krisp JS, pago e licenciado só para ele): RNNoise, rede neural de
  código aberto (BSD) do pacote `@sapphi-red/web-noise-suppressor`, servido em `/vendor/ruido`; roda no navegador num
  AudioWorklet (`makeDenoise`, 48 kHz de verdade, ~10 ms de atraso) entre o microfone e o que vai para a call.
  NÃO volte para o GTCRN: ele só trabalha em 16 kHz e corta tudo acima de 8 kHz (voz abafada; medido).
  Qualidade da voz: `tuneSdp` ajusta a descrição que chega (Opus `maxaveragebitrate=96000`, `useinbandfec=1`, 48 kHz) e
  `voicePriority` dá prioridade alta e até 96 kbps ao som (o navegador mandava ~32 kbps). Teste `18-sons-e-qualidade`. `prefs.noise` (`cp-noise`): "ia" (padrão, a do navegador fica desligada como no Discord com o Krisp), "padrao"
  (a do navegador) ou "nenhuma". Botão de onda `#vpNoise` abre a janelinha `app.openNoisePop` (settings.js: liga/desliga,
  "Teste do microfone" que toca a sua voz já limpa, `app.audio.micTest`); opções em `#noiseRadio` (Voz e vídeo). Se o
  navegador não aguentar, cai na padrão com aviso. Teste `17-supressao-de-ruido` (microfone falso toca
  `tests/fixtures/fala-com-ruido.wav`, fala do Open Speech Repository com ventilador e teclado).
- `public/sfx.js`: TODOS os sons do site (`window.ChatPedroSfx.play("nome")`). Feitos no navegador, sem arquivos
  (os do Discord são dele): cada som é gravado uma vez em 48 kHz estéreo num OfflineAudioContext (marimba, sino de vidro,
  nota macia, "toc"; envelope sem estalo e eco de sala) quando o navegador está parado, depois só toca o buffer.
  Sons: `message`, `mention`, `mute`/`unmute`, `deafen`/`undeafen`, `join`/`leave` (você na call), `userJoin`/`userLeave`,
  `streamStart`/`streamEnd`, `pttOn`/`pttOff`, `activity`, `sent`, `react`, `test`. Cada um tem a opção `snd-*` em
  Notificações > Sons (ligar toca uma prévia, `data-sfx`); `allowed()` decide (avisos param com "Desativar todos" e
  "Não perturbe"; com o fone desativado só tocam mutar/fone). `bus()` é a saída com eco usada pelos toques do `ring.js`.
  Para conferir um som novo: grave em WAV e olhe o espectrograma (sem riscos verticais = sem estalo).
- `public/ring.js`: ligar na DM e na DM em grupo como no Discord. Quem começa a chamada faz tocar para os outros
  (servidor: `startDmCall`/`ringUser`/`stopRing`, eventos `call:ring`, `call:ringstop`, `call:ringing`, `call:decline`;
  toca por até 1 minuto, em qualquer aba do site). Janelinha "Chamada recebida..." (`.ringpop`, no meio da tela,
  arrastável, Esc = Ignorar; não aparece em "Não perturbe"); dentro da própria conversa aparece `#ringBar` no lugar da call.
  Quem liga vê quem não entrou apagado (`.tile.ghost`, pulsando com `.ringing`; clicar = "Tocar novamente").
  Atender de outra página abre `/s/<conversa>?atender=voz|video` e o `call.js` entra sozinho (`app.joinCall`).
  Anéis e durações iguais aos do Discord (`ringIn` 5,407 s, `ringOut` 2,5 s); os toques são feitos no navegador
  (WebAudio, `app.ringTone`) com o mesmo ritmo, mas melodia própria. Mensagem `m.call` na conversa ("Fulano iniciou uma
  chamada que durou 5 minutos." / "Você perdeu uma chamada de Fulano."). Sons em Notificações: `snd-ring`, `snd-calling`.
  Teste `15-ligar-na-dm`.
- `public/settings.js`: Configurações de usuário em tela cheia (mesmo layout `gs-*` das do servidor): Minha conta,
  Perfis (com prévia), Conteúdo e social, Dados e privacidade, Dispositivos, Conexões, Aparência, Acessibilidade,
  Voz e vídeo (`#settings`), Bate-papo, Notificações, Atalhos, Idioma, Modo streamer, Avançado (modo
  desenvolvedor), Privacidade nas atividades. Também o cartão da conta (clique no próprio nome) e os menus das
  setinhas do microfone e do fone (`#upPop`, `app.openDeviceMenu`). Abrir: `app.openUserSettings("voz")`.
  Preferências ficam no navegador (`chatpedro-prefs`); no chat use `P("nome")`; viram classes no `body`
  (`compact`, `no-reactions`, `spoilers-open`, `reduce-motion`...) e variáveis (`--chat-fs`, `--group-gap`).
- Conversa privada (`body.dm`): coluna da esquerda com as conversas (`#dmSide`, desenhada por `home.js`),
  botões de ligar/vídeo no topo (`#dmCallBtn`, `#dmVideoBtn`), começo da conversa com o perfil (`#dmIntro`)
  e o perfil da pessoa na coluna da direita (`.dmprof`).
- `public/guild.js`: Configurações do servidor (cargos, emojis, figurinhas, boas-vindas, Descobrir,
  link personalizado, banner, webhooks).
- `public/home.js`: Início (amigos, DMs, DM em grupo), Descobrir e a lista de conversas da DM.
- `public/emoji.js`: lista de emojis com nomes em português.
- `public/siteadm.js`: botão "adm" no canto de cima à direita. Com a senha (`ADMIN_PASSWORD`, só no Render) toca um
  som para todo mundo e mostra foto/vídeo/áudio na tela de todos com o site aberto (até parar). Usa o canal
  Socket.io `/adm` (sem login, chega até na tela de entrada); API em `/api/adm/*`; o arquivo fica no disco temporário.
  Com a aba minimizada ou em outra aba: notificação do sistema com a foto (via `public/sw.js`, permissão pedida
  uma vez no primeiro clique) e o título da aba pisca; some quando a pessoa volta ou o adm para.
  Teste `10-painel-adm` (a senha de teste está no `run.sh`). O mesmo arquivo recarrega o site sozinho quando sai
  versão nova: o servidor manda `site:version` (hash dos arquivos) no `/adm`; o texto da caixa de mensagem volta.
  Os dois usam UM só `io("/adm")` (`window.ChatPedroAdmSocket`): um segundo `io("/adm")` abriria outra conexão inteira.
- Leveza (medida com Playwright + CDP `Performance.getMetrics`): a barrinha de ações de cada mensagem só é montada
  quando o mouse/dedo chega nela (`ensureActs`; nos testes, passe o mouse na linha antes de clicar nos botões); o chat
  aberto guarda no máximo ~320 linhas (volta para 220); a animação da tela de carregamento só roda enquanto carrega
  (`body.booted` esconde); brilhos que pulsam usam transform/opacity num `::after` (nunca animar `box-shadow` sem parar).
- Leveza no servidor e na rede (teste `19-memoria-do-servidor`): fotos/áudios/arquivos NÃO ficam na memória do servidor;
  depois de enviados para quem está online, saem do histórico em memória e vêm do banco (`mediaSrc`, `storage.getMedia`)
  com um cache de no máximo `MEDIA_CACHE_MB` (16) para o site inteiro; ao ligar, o `load()` só confere quais existem.
  A página é servida pelo `sendIndex` com `?v=<SITE_VERSION>` em cada `<script src="/...">` (cache de 1 ano, só para a
  versão atual); a página em si vai com `no-cache`. Script novo no `index.html`: só escrever `<script src="/x.js">`.
  O socket começa pelo WebSocket (`transports: ["websocket", "polling"], tryAllTransports: true`) e cai no polling se a
  rede bloquear. O handshake (`io.use`) faz as consultas ao banco juntas (`Promise.all`).
- Painel do usuário (embaixo à esquerda): se estica por baixo da barra de servidores como no Discord atual;
  microfone e fone com setinha (`.agrp`), vermelho quando mudo (`.off`); mostra "Em uma chamada" na call.
- **Programa do Windows** (pasta `desktop/`, Electron 45, com `package.json` próprio: o Render NÃO instala). A janela
  carrega o site de verdade (`CHATPEDRO_URL`, padrão `https://chat-pedro.onrender.com`), então mudança no site aparece
  no programa sem reinstalar; só mexer em `desktop/` exige versão nova do instalador.
  `main.js`: janelinha de abertura (`splash.html`, 300x350, "Verificando atualizações", "Acordando o servidor..." enquanto
  `/api/ping` não responde, "Sem conexão" com nova tentativa); janela sem moldura (`frame: false`, mínimo 940x500, lembra
  tamanho/posição em `%APPDATA%/Chat Pedro/config.json`); o X esconde perto do relógio (bandeja: abrir, silenciar
  microfone, desativar áudio, abrir junto com o Windows, atualizações, sair); número de não lidas no ícone da barra de
  tarefas (`setOverlayIcon`, desenhado pelo site) e bolinha vermelha no da bandeja; links de fora abrem no navegador
  (`setWindowOpenHandler`/`will-navigate`); F5/Ctrl+R não recarregam; Ctrl +/-/0 = zoom de Acessibilidade; F12 só com o
  modo desenvolvedor; menu do botão direito em português só em campos de texto, seleção, links e imagens; botões
  voltar/avançar do mouse; uma instância só; atualização pelo GitHub Releases (`electron-updater`, seta verde na barra
  quando baixou). Atalhos globais (funcionam com jogo na frente) com `uiohook-napi`: segurar para falar (tecla ou
  MOUSE4/5, ignora CTRL/SHIFT apertados), mutar e desativar áudio (com CTRL/SHIFT/ALT exatos). "Jogando ...": `tasklist`
  a cada 15 s comparado com `games.js` (nome do .exe em minúsculas) e com os jogos que a pessoa adicionou.
  Compartilhar tela: `setDisplayMediaRequestHandler` manda a lista de telas/janelas para o site escolher (`#pickModal`);
  som do computador com `loopback` (o Electron 45+ respeita o `restrictOwnAudio` do site: sem o som da própria call).
  `preload.js` expõe `window.ChatPedroDesktop` só para a página do Chat Pedro; o main confere a origem de cada pedido.
  No site: `public/desktop.js` (para na 1ª linha fora do programa) põe os botões da janela na barra de cima
  (`html.desktop`, `-webkit-app-region: drag`, botões 32x32 medidos no Discord, telas cheias começam em `top: 32px`),
  `app.onAlert`/`app.onRing` (menção/DM com a janela sem foco: número no ícone e pisca), `app.onVoice` + `app.audio.toggleMic/
  toggleDeaf/ptt`, `app.setGame` (evento `profile` com `game`; o servidor manda `game` nos `profiles`, some com `hideAct`;
  `activityOf` mostra "Jogando X"), e as páginas "Configurações do Windows", "Jogos registrados" e os atalhos globais
  no começo de "Atalhos do teclado". "Longe" para avisos: `window.ChatPedroAway()` (no programa = janela sem foco ou
  escondida, informado pelo main). No programa os avisos do Windows vêm ligados (`chatpedro-notif` só desliga com "off").
  No site aberto no Windows (navegador) aparece o botão `#railDl` "Baixar o app" (link fixo
  `releases/latest/download/ChatPedroSetup.exe`), só quando `/api/app` diz que há instalador publicado (o servidor
  confere a última release do GitHub a cada 30 min). Ícones: `desktop/tools/icons.js` (desenho próprio: balão branco no
  quadrado azul). Teste `21-app-windows` (abre o Electron numa tela virtual Xvfb; teclas globais e bandeja de mentira por
  `global.__cp` com `CHATPEDRO_TEST=1`; pulado se não houver `desktop/node_modules`).
  **Montar e publicar o instalador** (`dist/ChatPedroSetup.exe`, ~110 MB, sem assinatura: o Windows avisa "programa
  desconhecido", é só clicar em "Mais informações > Executar assim mesmo"): `cd desktop && npm install`; precisa do wine
  (`dpkg --add-architecture i386 && apt-get update && apt-get install -y wine64 wine32:i386`); suba a `version` do
  `desktop/package.json`; `npm run dist`; crie a release `app-v<versão>` pela API do GitHub e mande `ChatPedroSetup.exe`,
  `ChatPedroSetup.exe.blockmap` e `latest.yml` (o programa instalado acha a versão nova sozinho pelo `latest.yml`).

## Permissões
Dono e ADM têm todas. Cargos personalizados dão: `channels`, `messages`, `members`, `ban`, `server`,
`roles`, `everyone`. No servidor use `can(perm)`; no navegador `can(perm)` / `app.can(perm)`.

## Testes (rode depois de qualquer mudança)
- `tests/run.sh` roda tudo; `tests/run.sh 05 07` só alguns; `tests/run.sh fuzz` só poker, truco e Mesa do Blefe.
  O `run.sh` só mostra as falhas; "TUDO OK" no fim quer dizer que passou.
- Usa um Supabase falso (`tests/fake-supabase.js`, porta 3330) e o site na porta 3331, com Playwright
  e Chromium (já instalados na nuvem). Fotos de tela em `tests/out/` (fora do git).
- Cada teste imprime `OK`/`FALHA` por item e `erros: []` quando a página não deu erro de JavaScript.
- `21-app-windows` precisa do `desktop/node_modules` (rode `npm install` em `desktop/`) e do `Xvfb` (já instalado).
- `08-configuracoes` (painel, cartão da conta, Configurações, excluir conta) e `09-call-e-dm` (call e DM novas).
- Se mudar um id ou classe do HTML, atualize os testes. Teste novo: copie o estilo de `07-recursos-discord.js`.
  Em testes, procure classes das Configurações dentro da janela certa (`#guildModal .gs-toggle`), porque as
  Configurações de usuário usam as mesmas classes.
- Para fotos de tela fora dos testes: suba o Supabase falso e o site como no `run.sh` e use um script
  Playwright no scratchpad (cada execução precisa de e-mails novos ou de reiniciar o Supabase falso).
- Cuidado: `pkill -f` com um padrão que aparece no próprio comando mata o terminal (mate pelo PID).
- Antes de commitar: `node --check` nos arquivos JS mudados.
- O servidor nunca pode cair por um pedido malfeito: todo `socket.on` passa pelo `guardSocket` (erro vira registro) e há
  `process.on("uncaughtException")`. Silenciados ficam salvos (`mutes` no `chat_kv`). Teste `13-correcoes`.

## Plugins do Claude Code (pedidos pelo dono)
- `.claude/settings.json` instala em toda sessão o **caveman** (JuliusBrussee/caveman: respostas curtas, sem enrolação) e o
  **superpowers** (obra/superpowers: habilidades de planejar, depurar, testar e revisar). Mesmo com o caveman, as respostas
  para o dono continuam em português simples, explicando o que mudou no site. Desligar o caveman na conversa: "stop caveman".

## Commits
Mensagens de commit em português. Não escreva nome/versão de modelo de IA em código, commits ou PR.

## O que ficou de fora do Discord (e por quê)
o Krisp (pago e licenciado só para o Discord; no lugar está o RNNoise, livre); os arquivos de som do Discord (são dele, como os ícones: os nossos são feitos no código pelo `sfx.js`, nos mesmos
momentos, com melodias próprias; o toque de chamada tem o mesmo ritmo e duração); GIFs e soundboard (pedido do dono; por isso o painel "Voz conectada" tem 3 botões e não 4); Nitro, impulsos,
loja, presentes, missões e super reações (sistema pago); bots com comandos e apps (rodar código de terceiros);
conexões verificadas (precisa de conta de desenvolvedor em cada site; hoje a pessoa digita o usuário); clipes e
fundo de vídeo (pesado demais para o plano grátis); temas claros (o dono pediu só o do Discord); no navegador,
atalhos globais e jogos registrados (o navegador não deixa; no programa do Windows existem); sobreposição dentro do jogo
(antitrapaça de alguns jogos bloqueia ou pune programas que desenham por cima); app de Mac/Linux e assinatura do
instalador (certificado pago); trocar o e-mail
(o e-mail de confirmação grátis do Supabase não chega); Central da Família e outros idiomas; pedidos de
mensagem de desconhecidos (DM só com amigos ou quem divide servidor); "servidores mútuos" na DM e "Copiar ID"
de servidor (ainda não feitos). "Online" vale por servidor, não pelo site inteiro.
