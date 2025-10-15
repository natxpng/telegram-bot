require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { handleOnboarding } = require('./onboarding');
const { handleGasto, handleResumoGastos, handleGrafico } = require('./gastos');
const { handlePerguntaIA } = require('./ia');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const texto = msg.text?.trim();

  if (await handleOnboarding(bot, chatId, texto)) return;
  if (await handleGasto(bot, chatId, texto)) return;
  if (await handleResumoGastos(bot, chatId, texto)) return;
  if (await handleGrafico(bot, chatId, texto)) return;
  await handlePerguntaIA(bot, chatId, texto);
});

console.log('🤖 Bot do Telegram rodando!');