require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const bodyParser = require('body-parser');

// Imports dos Handlers (Funções)
const { handleGasto, handleResumoGastos } = require('./gastos');

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
bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);
console.log('🤖 Bot configurado com Webhook no modo "stateless".');

// Middlewares
app.use(bodyParser.json());

// Endpoint health check
app.get('/', (req, res) => res.json({ status: 'ok' }));

// Endpoint do webhook
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// --- NOVO HANDLER DE MENSAGENS SIMPLIFICADO ---
let nomesUsuarios = {};
bot.on('message', async (msg) => {
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const texto = msg.text.trim();

  // Pergunta o nome se não tiver salvo
  if (!nomesUsuarios[chatId]) {
    bot.sendMessage(chatId, 'Olá! Qual seu nome?');
    nomesUsuarios[chatId] = { aguardandoNome: true };
    return;
  }
  if (nomesUsuarios[chatId].aguardandoNome) {
    nomesUsuarios[chatId] = { nome: texto };
    bot.sendMessage(chatId, `Prazer, ${texto}! Pode registrar seus gastos normalmente.`);
    return;
  }

  // Registro de gastos
  if (await handleGasto(bot, chatId, texto, nomesUsuarios[chatId].nome)) return;

  // Resumo mensal ou semanal
  if (await handleResumoGastos(bot, chatId, texto)) return;

  // Se não for nenhum comando conhecido
  bot.sendMessage(chatId, 'Comando não reconhecido. Para registrar um gasto, digite algo como "gastei 50 no mercado". Para resumo, use /gastos ou /gastos semana.');
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 HTTP Server ativo na porta ${PORT}`);
});