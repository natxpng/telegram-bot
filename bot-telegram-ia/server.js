require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { handleOnboarding } = require('./onboarding');
const { handleGasto, handleResumoGastos, handleGrafico } = require('./gastos');
const { handlePerguntaIA } = require('./ia');
const bodyParser = require('body-parser');

const app = express();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

app.use(bodyParser.json());

// Endpoint health check
app.get('/', (req,res)=> res.json({status:'ok'}));

// Endpoint do webhook do Telegram
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const bot = new TelegramBot(TELEGRAM_TOKEN);
bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const texto = msg.text?.trim();

  if (await handleOnboarding(bot, chatId, texto)) return;
  if (await handleGasto(bot, chatId, texto)) return;
  if (await handleResumoGastos(bot, chatId, texto)) return;
  if (await handleGrafico(bot, chatId, texto)) return;
  await handlePerguntaIA(bot, chatId, texto);
});

// Listen port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 HTTP Server ativo em', PORT);
});