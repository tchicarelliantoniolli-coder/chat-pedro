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

## Bom saber

- No plano grátis o servidor dorme depois de uns 15 minutos sem ninguém. Quem entrar primeiro espera uns 30–60 segundos.
- As mensagens ficam na memória do servidor (as últimas 200). Quando ele dorme ou reinicia, o histórico é apagado.
- Fotos: botão `[FOTO]`, ou cole (Ctrl+V) / arraste uma imagem no chat. Clique na foto para ver grande. O servidor guarda as últimas 40 fotos.
- Comandos no chat: `/nick NOVO` muda o apelido, `/quem` mostra quem está online, `/limpar` limpa a tela.
- Qualquer pessoa com o link pode entrar. Não mande para quem você não quer no chat.
