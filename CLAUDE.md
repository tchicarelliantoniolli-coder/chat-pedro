# Chat Pedro

Chat para um grupo de amigos, no estilo do Discord. O dono do projeto fala português: responda sempre
em português simples (a pessoa não é programadora), explique o que mudou no site, não no código.

## Onde roda
- Código no GitHub `tchicarelliantoniolli-coder/chat-pedro`, branch `main`. Pode commitar e dar push
  direto na `main` (o Render publica sozinho em alguns minutos): https://chat-pedro.onrender.com
- Render plano grátis: o servidor dorme depois de ~15 min parado e tem pouca memória e CPU.
  Mantenha o site leve (nada de bibliotecas grandes, imagens reduzidas no navegador antes de enviar).
- Supabase: projeto `yvdlkwdmhlvpjmesmkye` (região São Paulo). Tabelas: `profiles`, `servers`,
  `server_members`, `server_invites`, `server_bans`, `friendships` e `chat_kv` (chave/valor com o
  histórico, fotos, áudios e os dados de cada servidor em `srv:<id>:<nome>`). RLS ligado e nenhuma
  regra pública: só o servidor acessa, com a chave secreta. Mudança de tabela: use migração do Supabase.

## Segurança (regras do dono)
- NUNCA coloque segredos no código ou no repositório (é público). A `SUPABASE_SECRET_KEY` fica só no
  Render (Environment). Peça para a pessoa nunca colar essa chave no chat nem mostrar em print.
- A chave publicável (`sb_publishable_...`) pode ficar no código.
- Senhas e chaves só por variável de ambiente.

## Regras de design (pedidas pelo dono)
- Visual igual ao Discord: cores, tamanhos e fonte do Discord ("gg sans"), tokens no `:root` do
  `public/index.html` (tirados do CSS do discord.com com o REA). Só o tema do Discord, sem outros temas.
- "CHAT PEDRO" fica no canto de cima à esquerda; o nome do servidor fica no topo da barra de canais.
- Ícones em vez de texto quando der; nada de colchetes [ ] para enfeite; minimalista.
- A call é ação principal (botão grande no topo e canais de voz na barra); nada de botões duplicados.
- Animações suaves como as do Discord.
- Sem GIFs e sem soundboard (o dono pediu para tirar).
- Só UMA reação por pessoa em cada mensagem (a nova substitui a antiga).
- Quem cria o servidor é o dono e moderador dele.

## Arquivos
- `server.js`: Express + Socket.io. API REST em `/api` (contas, servidores, convites, DM, amigos,
  Descobrir, webhooks, prévia de links) e o tempo real. Cada servidor é um "ctx" separado (canais,
  histórico, call, poker, truco, cargos, emojis...). DM e DM em grupo são servidores com `dm = true`.
- `db.js` (acesso ao Supabase), `storage.js` (salva o chat e os dados do servidor no `chat_kv`).
- `poker.js` e `truco.js` (servidor) e `public/poker.js`, `public/truco.js` (tela dos jogos).
- `public/index.html`: todo o CSS e o JS principal do chat (mensagens, canais, tópicos, fórum,
  markdown, emojis, membros, cartão de perfil, moderação).
- `public/boot.js`: login, 2 etapas, barra de servidores, menu do servidor, perfil.
- `public/call.js`: call (WebRTC), canais de voz, palco, sensibilidade do microfone, assistir YouTube junto.
  Visual da call igual ao do Discord: fundo preto, só fotos redondas quando ninguém tem câmera (`#tiles.avmode`),
  barra de botões em grupos (`.ctray`), menu "..." e Atividades (`app.actsMenu`); painel "Voz conectada" com 3 botões.
- Conversa privada (`body.dm`): coluna da esquerda com as conversas (`#dmSide`), botões de ligar/vídeo no topo,
  começo da conversa com o perfil (`#dmIntro`) e o perfil da pessoa na coluna da direita.
- `public/guild.js`: Configurações do servidor (cargos, emojis, figurinhas, boas-vindas, Descobrir,
  link personalizado, banner, webhooks).
- `public/home.js`: Início (amigos, DMs, DM em grupo) e Descobrir.
- `public/emoji.js`: lista de emojis com nomes em português.
- `public/settings.js`: Configurações de usuário em tela cheia (Minha conta, Perfis, Voz e vídeo, Aparência,
  Bate-papo, Notificações...), o cartão da conta (clique no próprio nome) e os menus das setinhas do microfone e
  do fone. Preferências ficam no navegador (`chatpedro-prefs`); no chat use `P("nome")`.

## Permissões
Dono e ADM têm todas. Cargos personalizados dão: `channels`, `messages`, `members`, `ban`, `server`,
`roles`, `everyone`. No servidor use `can(perm)`; no navegador `can(perm)` / `app.can(perm)`.

## Testes (rode depois de qualquer mudança)
- `tests/run.sh` roda tudo; `tests/run.sh 05 07` só alguns; `tests/run.sh fuzz` só poker e truco.
- Usa um Supabase falso (`tests/fake-supabase.js`, porta 3330) e o site na porta 3331, com Playwright
  e Chromium (já instalados na nuvem). Fotos de tela em `tests/out/` (fora do git).
- Cada teste imprime `OK`/`FALHA` por item e `erros: []` quando a página não deu erro de JavaScript.
- Se mudar um id ou classe do HTML, atualize os testes. Teste novo: copie o estilo de `07-recursos-discord.js`.
- Cuidado: `pkill -f` com um padrão que aparece no próprio comando mata o terminal.
- Antes de commitar: `node --check` nos arquivos JS mudados.

## Commits
Mensagens de commit em português. Não escreva nome/versão de modelo de IA em código, commits ou PR.

## O que ficou de fora do Discord (e por quê)
GIFs e soundboard (pedido do dono; por isso o painel "Voz conectada" tem 3 botões e não 4); Nitro, impulsos, loja, missões e super reações (sistema pago);
bots com comandos e apps (rodar código de terceiros); conexões verificadas (precisa de conta de
desenvolvedor em cada site; hoje a pessoa digita o usuário); clipes e fundo de vídeo (pesado demais
para o plano grátis); temas claros (o dono pediu só o do Discord); atalhos de teclado personalizáveis, jogos
registrados e sobreposição de jogo (o navegador não deixa); Central da Família e outros idiomas; pedidos de mensagem de desconhecidos (DM só com amigos ou quem divide servidor).
