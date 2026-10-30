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
- O app do Discord exige login; não dá para abrir as telas logado. O que funciona: abrir o discord.com
  num Chromium com `--remote-debugging-port` e usar `mcp__rea__inspect_web_page` (resultado grande vai para
  arquivo; ler com `jq`). Os CSS do app estão listados no HTML de `https://discord.com/app` (`/assets/*.css`)
  e os carregados depois estão no mapa `"<id>"===e?...".css"` do `web.*.js`. Baixe tudo e procure as regras
  pelo nome da classe (ex.: `panels_`, `audioButtonParent_`, `actionButtons_`, `wrapper_cb9592`).
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
  three.js fica no `node_modules` e é servido em `/vendor/three` só quando abre a mesa; "modo leve" sem sombras.
  Testes `11-mesa-do-blefe` e `fuzz-blefe.js`.
- Tela cheia nos jogos: botão `.gfull` (`#actFull`, `#trFull`, `#blFull`) no topo de cada jogo; usa a tela cheia do
  navegador na seção do jogo e, onde não dá (iPhone), a classe `.gamefull` (ocupa a janela). Sai com Esc ou ao fechar o jogo.
- `public/index.html`: todo o CSS e o JS principal do chat (mensagens, canais, tópicos, fórum, markdown,
  emojis, membros, cartão de perfil, moderação, painel do usuário, tela de carregamento "Você sabia").
  As páginas das Configurações de usuário também estão no HTML (`#userSettings`, uma `.us-page` por seção).
- `public/boot.js`: login, 2 etapas, barra de servidores, menu do servidor, perfil (`window.ChatPedroAuth`:
  `updateProfile`, `deleteAccount`, `signOutOthers`, `exportData`...).
- `public/call.js`: call (WebRTC), canais de voz, palco, sensibilidade do microfone, assistir YouTube junto.
  Visual igual ao do Discord: fundo preto, só fotos redondas quando ninguém tem câmera (`#tiles.avmode`, com
  bolinha vermelha `.mbadge` de mudo), barra de botões em grupos (`.ctray`), menu "..." (`#moreBtn`) e
  Atividades (`app.actsMenu`: YouTube junto, Poker, Truco); painel "Voz conectada" com 3 botões
  (`#vpCam`, `#vpScreen`, `#vpAct`) e supressão de ruído (`#vpNoise`). `app.audio` serve os menus das setinhas.
  Volume de cada pessoa como no Discord: botão direito (ou segurar o dedo) na pessoa na lista do canal de voz ou no
  quadro da call abre `userMenu` ("Volume do usuário" 0–200%, "Silenciar" só para você, "Redefinir volume"); fica em
  `cp-vol-<nick>` e `cp-lmute-<nick>`. Acima de 100% (e no iPhone) o som passa por um GainNode (`boost`). Teste `12-volume-na-call`.
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
- Painel do usuário (embaixo à esquerda): se estica por baixo da barra de servidores como no Discord atual;
  microfone e fone com setinha (`.agrp`), vermelho quando mudo (`.off`); mostra "Em uma chamada" na call.

## Permissões
Dono e ADM têm todas. Cargos personalizados dão: `channels`, `messages`, `members`, `ban`, `server`,
`roles`, `everyone`. No servidor use `can(perm)`; no navegador `can(perm)` / `app.can(perm)`.

## Testes (rode depois de qualquer mudança)
- `tests/run.sh` roda tudo; `tests/run.sh 05 07` só alguns; `tests/run.sh fuzz` só poker, truco e Mesa do Blefe.
  O `run.sh` só mostra as falhas; "TUDO OK" no fim quer dizer que passou.
- Usa um Supabase falso (`tests/fake-supabase.js`, porta 3330) e o site na porta 3331, com Playwright
  e Chromium (já instalados na nuvem). Fotos de tela em `tests/out/` (fora do git).
- Cada teste imprime `OK`/`FALHA` por item e `erros: []` quando a página não deu erro de JavaScript.
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

## Commits
Mensagens de commit em português. Não escreva nome/versão de modelo de IA em código, commits ou PR.

## O que ficou de fora do Discord (e por quê)
o arquivo de som do toque de chamada (é do Discord, como os ícones: o nosso é feito no código, mesmo ritmo e
duração, melodia própria); GIFs e soundboard (pedido do dono; por isso o painel "Voz conectada" tem 3 botões e não 4); Nitro, impulsos,
loja, presentes, missões e super reações (sistema pago); bots com comandos e apps (rodar código de terceiros);
conexões verificadas (precisa de conta de desenvolvedor em cada site; hoje a pessoa digita o usuário); clipes e
fundo de vídeo (pesado demais para o plano grátis); temas claros (o dono pediu só o do Discord); atalhos de
teclado personalizáveis, jogos registrados e sobreposição de jogo (o navegador não deixa); trocar o e-mail
(o e-mail de confirmação grátis do Supabase não chega); Central da Família e outros idiomas; pedidos de
mensagem de desconhecidos (DM só com amigos ou quem divide servidor); "servidores mútuos" na DM e "Copiar ID"
de servidor (ainda não feitos). "Online" vale por servidor, não pelo site inteiro.
