require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { handleOnboarding } = require('./onboarding');
const { handleGasto, handleResumoGastos, handleGrafico } = require('./gastos');
const { handlePerguntaIA } = require('./ia');
const bodyParser = require('body-parser');

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
bot.on('message', async (msg) => {
  // Evita processar mensagens sem texto (ex: fotos, stickers)
  if (!msg.text) {
    bot.sendMessage(msg.chat.id, "Desculpe, eu só consigo processar mensagens de texto no momento.");
    return;
  }

  const chatId = msg.chat.id;
  const texto = msg.text.trim();

  // Se for /start, força o onboarding
  if (texto === '/start') {
    await handleOnboarding(bot, chatId, texto);
    return;
  }

  // --- Lógica principal ---
  // Tenta lidar com o onboarding (se o usuário não terminou)
  if (await handleOnboarding(bot, chatId, texto)) return;
  
  // Se não for onboarding, tenta lidar com comandos
  if (await handleGasto(bot, chatId, texto)) return;
  if (await handleResumoGastos(bot, chatId, texto)) return;
  if (await handleGrafico(bot, chatId, texto)) return;
  
  // Se não for nenhum comando, manda para a IA
  await handlePerguntaIA(bot, chatId, texto);
});

// Inicia o servidor Express
app.listen(PORT, () => {
  console.log(`🚀 HTTP Server ativo na porta ${PORT}`);
});