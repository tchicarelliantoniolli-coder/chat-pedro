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

## Contas, servidores e banco (Supabase)

O site usa o Supabase (projeto `chat-pedro`, regiao Sao Paulo) para:

- **contas** com e-mail e senha;
- **servidores** estilo Discord: cada um tem seu chat, call, poker, truco e moderacao. Quem nao e membro nao ve nada;
- **convites por link** (`/convite/CODIGO`), com validade de 1 hora, 1 dia, 7 dias ou sempre;
- guardar o chat de cada servidor (mensagens, reacoes, fotos e audios por 30 dias).

As tabelas ja estao criadas, com RLS ligado e sem regras publicas: so o servidor do site acessa, com a chave secreta.

**Obrigatorio:** no Render, em **Environment**, adicione `SUPABASE_SECRET_KEY` com a chave secreta do projeto
(Supabase > Project Settings > API Keys > Secret keys, a que comeca com `sb_secret_`). Sem ela ninguem consegue entrar.
Nunca coloque essa chave no codigo nem mande para ninguem.

**Cargos em cada servidor:** dono (quem criou), ADM (o dono promove) e membro. Dono e ADMs moderam: silenciar,
expulsar (volta so com convite novo), banir (por tempo ou para sempre), apagar mensagens e limpar o chat.
Nas mesas de poker, o dono e os ADMs fazem o papel que antes era do ADM com senha.

**Esqueci a senha:** o envio de e-mail gratis do Supabase so entrega para quem e da equipe do projeto. Para os
links de "esqueci a senha" chegarem para todo mundo, configure um SMTP proprio em
Supabase > Authentication > Emails > SMTP Settings (por exemplo o Resend, que tem plano gratis).
As contas novas ja sao criadas confirmadas, entao o cadastro funciona mesmo sem SMTP.

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
- Cada servidor guarda as últimas 200 mensagens no Supabase.
- Os botões do topo são ícones: espadas (poker), paus (truco), fone (call), pessoas (online, no celular) e engrenagem (servidor). Passe o mouse para ver o nome.
- Fotos: ícone de imagem ao lado do campo de mensagem, ou cole (Ctrl+V) / arraste uma imagem no chat. Clique na foto para ver grande.
- Áudio: ícone de microfone ao lado do campo de mensagem, grava até 1 minuto.
- Chat: passe o mouse numa mensagem para responder, reagir ou apagar. `@nome` menciona alguém (Tab completa).
- Meu perfil (canto de baixo da barra da direita): foto, apelido, cor do nome, status, tema (verde, âmbar, azul, Windows 95) e notificações.
- Call: microfone, fone, câmera, tela, sons, YouTube junto e configurações (volume e apertar para falar com ESPAÇO). Áudio e vídeo vão direto entre os navegadores (WebRTC).
- Poker: Texas Hold'em No-Limit, até 9 jogadores, blinds 10/20, 1000 fichas iniciais. Só o dono e os ADMs trancam a mesa e liberam fichas novas.
- Truco: Truco Paulista, mesa de 4 ou 6, partida até 12.
- Moderação: engrenagem > Moderar (dono e ADMs). O anti-flood silencia por 2 min quem insistir.
- Comandos no chat: `/nick NOVO`, `/perfil`, `/limpar`, `/ajuda`.
