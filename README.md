# Chat Pedro

Chat para os amigos no estilo do Discord: servidores, canais de texto e voz, mensagens diretas, call, poker e truco.

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
- O visual segue o Discord: servidores na esquerda, canais (texto, voz e atividades), chat no meio e membros na direita.
- **Canais**: o dono e os ADMs criam canais de texto e de voz (o "+" ao lado de cada categoria), com nome, tópico e modo lento. A engrenagem do canal edita ou apaga. Canal com mensagem nova fica em branco; menção mostra o contador vermelho. Botão direito no canal: marcar como lido, silenciar, copiar link.
- **Canais de voz**: clique para entrar. Quem está na call aparece embaixo do canal; o painel "Voz conectada" tem o botão de desconectar. No celular, use o botão "Call" do topo.
- **Mensagens diretas**: no cartão de perfil de alguém, "Mandar mensagem". A conversa aparece redonda no topo da barra da esquerda, com bolinha vermelha quando chega mensagem nova. Tem call também.
- **Painel do usuário** (embaixo da barra de canais): perfil, "Sobre mim", status (Online, Ausente, Não perturbe, Invisível), troca de senha, microfone, fone e áudio e vídeo.
- **Mensagens**: responder, reagir com qualquer emoji (uma reação por pessoa), editar (ou seta para cima), fixar, apagar (Shift pula a confirmação), encaminhar para outro canal, salvar, marcar como não lida, falar em voz alta (TTS), copiar texto e link. Botão direito na mensagem abre o menu completo.
- **Botão "+"** na caixa de texto: foto, foto com spoiler, arquivo (até 2 MB) e enquete (até 10 respostas, com prazo). Áudio de até 1 minuto no microfone.
- **Formatação**: `**negrito**`, `*itálico*`, `__sublinhado__`, `~~riscado~~`, `` `código` ``, blocos com três crases, `||spoiler||`, `> citação`, `# título`, `-# texto pequeno`, listas, `[texto](link)`, `#canal`, `@nome`, `@everyone`/`@here` (moderação) e `:emoji:`. Links do YouTube viram cartão.
- **Comandos** (digite `/`): `/me`, `/shrug`, `/tableflip`, `/unflip`, `/spoiler`, `/tts`, `/nick`, `/perfil`, `/limpar`, `/atalhos`, `/ajuda`.
- **Atalhos**: Ctrl+K troca de canal ou servidor rápido, Alt+↑/↓ muda de canal, Ctrl+E abre os emojis, Ctrl+Shift+M liga/desliga o microfone, Ctrl+Shift+D o fone, Esc marca como lido e Ctrl+/ mostra todos.
- **Caixa de entrada** (ícone no topo): suas menções e as mensagens salvas. **Busca** (use `de: nome`) e **fixadas** no alfinete.
- **Eventos**: crie eventos com data e hora; quem quiser marca "Tenho interesse".
- **Membros** agrupados em Dono, ADM, Online e Offline, com status e "Sobre mim". Dá para bloquear alguém (as mensagens dele ficam escondidas para você).
- **Atividades**: Poker (Texas Hold'em, até 9) e Truco Paulista (mesa de 4 ou 6).
- **Moderação** (nome do servidor > Moderar membros): silenciar, expulsar, banir, AutoMod com palavras bloqueadas, registro de moderação e limpar o canal. Convites ativos podem ser vistos e cancelados. O anti-flood silencia por 2 min quem insistir.
