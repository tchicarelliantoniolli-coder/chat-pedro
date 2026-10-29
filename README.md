# Chat Pedro

Chat retrô estilo terminal. Cada pessoa entra só digitando um apelido.

## Rodar no seu computador (opcional)

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
npm install
npm start
```

Abra http://localhost:3000.

## Publicar de graça no Render

1. Crie uma conta em https://github.com e um repositório novo chamado `chat-pedro`.
2. Envie para ele os arquivos desta pasta: `package.json`, `package-lock.json`, `server.js`, `.gitignore` e a pasta `public`. Não envie a pasta `node_modules`.
   Dá para fazer pelo site: no repositório, clique em **Add file → Upload files** e arraste os arquivos.
3. Crie uma conta em https://render.com usando o login do GitHub.
4. No painel do Render: **New → Web Service** e escolha o repositório `chat-pedro`.
5. Preencha:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
6. Clique em **Deploy Web Service**. Em uns minutos aparece o endereço, algo como `https://chat-pedro.onrender.com`.
7. Mande esse endereço para os amigos.

## Senha do ADM

A senha do ADM não fica no código (o repositório é público). Ela fica no Render:

1. No serviço `chat-pedro`, abra **Environment**.
2. **Add Environment Variable**: Key `ADMIN_PASSWORD`, Value com a senha.
3. Salve (**Save Changes**). O Render reinicia o servidor com a senha nova.

No site, clique em `[ADM]` no canto de cima e digite a senha. Depois de 5 senhas erradas, aquele endereço fica 10 minutos bloqueado.

## Guardar o chat (para nao sumir quando o servidor reinicia)

Usa o Upstash Redis, que tem plano gratis.

1. Crie uma conta em https://upstash.com e clique em **Create Database** (tipo Redis, plano Free, regiao mais perto).
2. Na pagina do banco, procure a parte **REST API** e copie `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
3. No Render, em **Environment**, adicione essas duas variaveis com os valores copiados e salve.

Ficam guardados: mensagens, reacoes, fotos e audios (30 dias), fotos de perfil e cores dos nomes. As fichas do poker e o truco continuam so na memoria.

## Call em qualquer rede (servidor TURN)

Sem TURN, a call pode nao conectar em 4G ou Wi-Fi de escola/empresa.

1. Crie uma conta gratis num servico de TURN (por exemplo https://www.metered.ca/stun-turn, plano gratis).
2. Pegue os enderecos `turn:...` e `turns:...`, o usuario e a senha.
3. No Render, em **Environment**, adicione:
   - `TURN_URLS`: os enderecos separados por virgula
   - `TURN_USERNAME`: o usuario
   - `TURN_CREDENTIAL`: a senha

## Dominio proprio (opcional, pago)

Compre um dominio (ex.: no Registro.br para `.com.br`). No Render, em **Settings > Custom Domains**, adicione o dominio e copie os registros DNS que ele mostrar para o painel onde voce comprou.

## Bom saber

- No plano grátis o servidor dorme depois de uns 15 minutos sem ninguém. Quem entrar primeiro espera uns 30–60 segundos.
- As mensagens ficam na memória do servidor (as últimas 200). Quando ele dorme ou reinicia, o histórico é apagado.
- Fotos: botão `[FOTO]`, ou cole (Ctrl+V) / arraste uma imagem no chat. Clique na foto para ver grande. O servidor guarda as últimas 40 fotos.
- Quem está online aparece na barra da direita (no celular, no botão `[ONLINE n]`). A foto de perfil é escolhida em `[FOTO DE PERFIL]` e fica salva no navegador de cada um.
- Chamada: botão `[ENTRAR NA CHAMADA]`. Dá para ligar microfone, câmera e compartilhar a tela; o volume de cada pessoa fica no `VOL` do quadro dela e o resto em `[CONFIG]`. Áudio e vídeo vão direto entre os navegadores (WebRTC); em algumas redes (4G, redes de empresa/escola) a conexão pode não fechar.
- Poker: botão `[POKER]`. Texas Hold'em No-Limit, até 9 jogadores, blinds 10/20, 1000 fichas iniciais. Só o ADM tranca a mesa e libera fichas novas para quem perdeu tudo. As fichas ficam na memória do servidor e voltam a 1000 quando ele reinicia.
- Truco: botão `[TRUCO]`. Truco Paulista (vira e manilha), mesa de 4 (2x2) ou 6 (3x3) escolhida por quem cria a mesa, partida até 12, com mão de onze, mão de ferro, carta encoberta, zoeira e sinais para o parceiro.
- Chat: passe o mouse numa mensagem para [RESPONDER], [REAGIR] ou [APAGAR] (a sua; o ADM apaga qualquer uma). `@nome` menciona alguem (Tab completa). [AUDIO] grava ate 1 minuto.
- [MEU PERFIL]: foto, cor do nome, status (online, ausente, ocupado), tema (verde, ambar, azul, Windows 95) e notificacoes.
- Call: [SONS] toca sons para todos, [YOUTUBE] assiste um video junto, e em [CONFIG] da para ligar o apertar para falar (segure ESPACO).
- ADM: no painel [ADM] da para silenciar, expulsar (por 5 min ate 1 dia), liberar e limpar o chat. O anti-flood bloqueia mensagens demais e silencia por 2 min quem insistir.
- Comandos no chat: `/nick NOVO` muda o apelido, `/perfil` troca a foto de perfil, `/limpar` limpa a tela, `/ajuda` mostra os atalhos.
- Qualquer pessoa com o link pode entrar. Não mande para quem você não quer no chat.
