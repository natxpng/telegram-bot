require('dotenv').config();
const { salvarTriagemNotion } = require('./notion');

const perguntasOnboarding = [
  'Qual seu nome?',
  'Qual sua renda mensal?',
  'Qual o total de gastos fixos mensais?',
  'Qual o total de gastos variáveis mensais?',
  'Qual sua meta de poupança mensal?'
];

const usuarios = {};

async function handleOnboarding(bot, chatId, texto) {
  if (!usuarios[chatId]) {
    usuarios[chatId] = { etapa: 0, respostas: [] };
  }
  if (usuarios[chatId].etapa < perguntasOnboarding.length) {
    if (texto === '/start') {
      usuarios[chatId] = { etapa: 0, respostas: [] };
      bot.sendMessage(chatId, perguntasOnboarding[0]);
      return true;
    }
    usuarios[chatId].respostas.push(texto);
    usuarios[chatId].etapa++;
    if (usuarios[chatId].etapa < perguntasOnboarding.length) {
      bot.sendMessage(chatId, perguntasOnboarding[usuarios[chatId].etapa]);
    } else {
      const [nome, renda, fixos, variaveis, poupanca] = usuarios[chatId].respostas;
      await salvarTriagemNotion({ chatId, nome, renda: Number(renda), fixos: Number(fixos), variaveis: Number(variaveis), poupanca: Number(poupanca) });
      bot.sendMessage(chatId, 'Onboarding finalizado! Agora você pode registrar gastos ou tirar dúvidas financeiras.');
    }
    return true;
  }
  return false;
}

module.exports = { handleOnboarding, usuarios };
