require('dotenv').config();
const { salvarTriagemNotion } = require('./notion');

const perguntasOnboarding = [
  'Qual seu nome?', // Etapa 0
  'Qual sua renda mensal? (Digite apenas números, ex: 3000)', // Etapa 1
  'Qual o total de gastos fixos mensais? (ex: 1200)', // Etapa 2
  'Qual o total de gastos variáveis mensais? (ex: 800)', // Etapa 3
  'Qual sua meta de poupança mensal? (ex: 500)' // Etapa 4
];

// Este objeto só armazena usuários ENQUANTO estão no processo de 5 perguntas.
const usuariosEmOnboarding = {};

// Helper para validar entradas numéricas
function parseNumber(input) {
  const num = parseFloat(input.replace(',', '.'));
  return isNaN(num) ? null : num;
}

/**
 * Função para o server.js checar se o usuário está na memória
 */
function isOnboardingProcess(chatId) {
  return !!usuariosEmOnboarding[chatId];
}

/**
 * Gerencia o fluxo de onboarding (só é chamado via /start ou se já estiver em processo)
 */
async function handleOnboarding(bot, chatId, texto) {

  // 1. Comando /start (inicia ou reinicia o processo)
  if (texto === '/start') {
    bot.sendMessage(chatId, "Olá! Sou a Atena, sua assistente financeira. Vamos começar (ou recomeçar) seu cadastro com 5 perguntas rápidas.");
    usuariosEmOnboarding[chatId] = { etapa: 0, respostas: [] };
    bot.sendMessage(chatId, perguntasOnboarding[0]);
    return;
  }

  // 2. Se não for /start, checa se o usuário está no processo
  const state = usuariosEmOnboarding[chatId];
  if (!state) {
    // Isso não deve acontecer (server.js filtra), mas é uma segurança
    return;
  }

  // --- Daqui para baixo, o usuário ESTÁ no meio do onboarding ---

  // 3. Valida a resposta
  const etapaAtual = state.etapa;
  let valorInput = texto;

  // Etapas 1-4 devem ser números
  if (etapaAtual > 0 && etapaAtual < perguntasOnboarding.length) {
    const valorNum = parseNumber(texto);
    if (valorNum === null) {
      bot.sendMessage(chatId, `Opa! Esse valor não parece ser um número.\n\n${perguntasOnboarding[etapaAtual]}`);
      return; // Não avança a etapa
    }
    valorInput = valorNum; // Usa o número validado
  }
  
  // 4. Salva a resposta e avança a etapa
  state.respostas.push(valorInput);
  state.etapa++;

  // 5. Verifica se o onboarding terminou
  if (state.etapa < perguntasOnboarding.length) {
    // Não terminou, faz a próxima pergunta
    bot.sendMessage(chatId, perguntasOnboarding[state.etapa]);
  } else {
    // Terminou! Salva no Notion
    bot.sendMessage(chatId, "Salvando seus dados...");
    const [nome, renda, fixos, variaveis, poupanca] = state.respostas;
    
    try {
      // (Futuramente: adicionar lógica para ATUALIZAR se o usuário já existia)
      await salvarTriagemNotion({ chatId, nome, renda, fixos, variaveis, poupanca });
      bot.sendMessage(chatId, 'Onboarding finalizado! 🎉\n\nAgora você pode registrar gastos (ex: "gastei 50 no mercado") ou tirar dúvidas financeiras.');
      
      // CRÍTICO: Limpa o usuário da memória
      delete usuariosEmOnboarding[chatId];
      
    } catch (error) {
      console.error("Erro ao salvar triagem no Notion:", error);
      bot.sendMessage(chatId, "Ocorreu um erro ao salvar seus dados. Por favor, tente digitar /start novamente.");
    }
  }
}

module.exports = { handleOnboarding, isOnboardingProcess };