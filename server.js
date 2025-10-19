require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const bodyParser = require('body-parser');

// Imports dos Handlers (Funções)
const { buscarDadosUsuarioNotion } = require('./notion');
const { handleOnboarding, isOnboardingProcess } = require('./onboarding');
const { handleGasto, handleResumoGastos, handleGrafico } = require('./gastos');
const { handlePerguntaIA } = require('./ia');

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

// --- O NOVO HANDLER DE MENSAGENS ---
bot.on('message', async (msg) => {
  if (!msg.text) return; // Ignora stickers, fotos, etc.

  const chatId = msg.chat.id;
  const texto = msg.text.trim();

  // 1. O usuário está iniciando ou no MEIO do onboarding?
  // (isOnboardingProcess checa se o chatId está na memória temporária)
  if (texto === '/start' || isOnboardingProcess(chatId)) {
    await handleOnboarding(bot, chatId, texto); // Deixa o onboarding.js tomar conta
    return;
  }

  // --- Se chegou aqui, o usuário NÃO está no onboarding ---

  // 2. CHECA SE O USUÁRIO EXISTE (O "check" que você pediu)
  const dadosUsuario = await buscarDadosUsuarioNotion(chatId);

  // 3. SE O USUÁRIO EXISTE (conhecido)
  if (dadosUsuario) {
    // Passamos 'dadosUsuario' para evitar novas buscas no Notion
    if (await handleGasto(bot, chatId, texto, dadosUsuario)) return;
    if (await handleResumoGastos(bot, chatId, texto)) return;
    if (await handleGrafico(bot, chatId, texto)) return;
    
    // Se não for nenhum comando, manda para a IA (com contexto)
    await handlePerguntaIA(bot, chatId, texto, dadosUsuario);
  
  } else {
  // 4. SE O USUÁRIO NÃO EXISTE (novo) e NÃO digitou /start

    // Bloqueia comandos que precisam de cadastro
    if (await handleGasto(bot, chatId, texto, null)) return; 
    
    // Permite comandos que podem funcionar sem cadastro
    if (await handleResumoGastos(bot, chatId, texto)) return; // Vai mostrar R$ 0
    if (await handleGrafico(bot, chatId, texto)) return; // Vai mostrar gráfico vazio

    // Manda para a IA (sem contexto) - "O que deseja?"
    // A IA vai responder perguntas gerais sobre finanças
    await handlePerguntaIA(bot, chatId, texto, null);
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 HTTP Server ativo na porta ${PORT}`);
});