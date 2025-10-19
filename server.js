require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { handleOnboarding } = require('./onboarding');
const { handleGasto, handleResumoGastos, handleGrafico } = require('./gastos');
const { handlePerguntaIA } = require('./ia');
const bodyParser = require('body-parser');
const { buscarDadosUsuarioNotion } = require('./notion');

// Validação de variáveis de ambiente
if (!process.env.TELEGRAM_TOKEN || !process.env.WEBHOOK_URL) {
  console.error("ERRO: TELEGRAM_TOKEN ou WEBHOOK_URL não definidos no .env!");
  process.exit(1);
}

const app = express();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

// Configura o bot para NÃO usar polling
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
// Configura o Webhook
bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);

console.log('🤖 Bot configurado com Webhook no modo "stateless".');

// Middleware do Express
app.use(bodyParser.json());

// Endpoint health check (bom para o Render)
app.get('/', (req, res) => res.json({ status: 'ok' }));

// Endpoint do webhook do Telegram
// O bot vai receber as atualizações aqui
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Handler principal de mensagens
// Handler principal de mensagens
bot.on('message', async (msg) => {
  // Evita processar mensagens sem texto
  if (!msg.text) {
    bot.sendMessage(msg.chat.id, "Desculpe, eu só consigo processar mensagens de texto.");
    return;
  }

  const chatId = msg.chat.id;
  const texto = msg.text.trim();

  // 1. Busca no Notion para saber se o usuário já existe
  const dadosUsuario = await buscarDadosUsuarioNotion(chatId);

  // 2. Tenta rodar o onboarding. 
  // O handleOnboarding agora é inteligente. Ele vai:
  // - Iniciar se for /start
  // - Continuar se estiver no meio do processo
  // - Pedir /start se for um usuário 100% novo
  // - Retornar 'false' se o usuário já estiver cadastrado e não estiver no onboarding
  if (await handleOnboarding(bot, chatId, texto, dadosUsuario)) {
    return; // Mensagem foi tratada pelo onboarding
  }
  
  // 3. Se o usuário já fez onboarding (onboarding retornou false), 
  // processa os comandos normais.
  if (await handleGasto(bot, chatId, texto)) return;
  if (await handleResumoGastos(bot, chatId, texto)) return;
  if (await handleGrafico(bot, chatId, texto)) return;
  
  // 4. Se não for nenhum comando, manda para a IA
  await handlePerguntaIA(bot, chatId, texto);
});

// Inicia o servidor Express
app.listen(PORT, () => {
  console.log(`🚀 HTTP Server ativo na porta ${PORT}`);
});