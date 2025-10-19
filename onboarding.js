// onboarding.js
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
 * Gerencia o fluxo de onboarding de novos usuários.
 * @param {object} bot - Instância do TelegramBot
 * @param {number} chatId - ID do chat
 * @param {string} texto - Mensagem do usuário
 * @param {object | null} dadosUsuario - Dados do Notion (null se for novo)
 * @returns {boolean} - Retorna 'true' se a mensagem foi tratada aqui
 */
async function handleOnboarding(bot, chatId, texto, dadosUsuario) {

  // 1. Comando /start
  if (texto === '/start') {
    if (dadosUsuario) {
      // Usuário já existe, mas quer recomeçar
      bot.sendMessage(chatId, `Olá, ${dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário'}! Vamos recomeçar seu onboarding.`);
      // TODO: Você pode adicionar uma lógica para apagar os dados antigos do Notion se quiser
    } else {
      // Usuário novo
      bot.sendMessage(chatId, "Olá! Sou seu assistente financeiro. Vamos começar com algumas perguntas.");
    }
    
    // (Re)inicia o processo na memória
    usuariosEmOnboarding[chatId] = { etapa: 0, respostas: [] };
    bot.sendMessage(chatId, perguntasOnboarding[0]);
    return true; // Mensagem tratada
  }

  // 2. Verifica se o usuário está no meio do processo
  const state = usuariosEmOnboarding[chatId];
  if (!state) {
    // Não está no onboarding.
    // Se ele também não existe no Notion (verificado no server.js), 
    // ele é um usuário novo que não digitou /start.
    if (!dadosUsuario) {
       bot.sendMessage(chatId, "Olá! Parece que é sua primeira vez aqui. Por favor, digite /start para iniciarmos seu cadastro.");
       return true; // Mensagem tratada
    }
    // Se ele não está no onboarding E existe no Notion, não faz nada.
    return false; // Deixa a mensagem seguir para handleGasto, etc.
  }
  
  // --- Daqui para baixo, o usuário ESTÁ no meio do onboarding ---

  // 3. Valida a resposta
  const etapaAtual = state.etapa;
  let valorInput = texto;

  // Etapas 1, 2, 3, 4 (renda, fixos, etc.) devem ser números
  if (etapaAtual > 0 && etapaAtual < perguntasOnboarding.length) {
    const valorNum = parseNumber(texto);
    if (valorNum === null) {
      // Input inválido, pergunta de novo
      bot.sendMessage(chatId, `Opa! Esse valor não parece ser um número.\n\n${perguntasOnboarding[etapaAtual]}`);
      return true; // Mensagem tratada (não avança a etapa)
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
    const [nome, renda, fixos, variaveis, poupanca] = state.respostas;
    
    try {
      // TODO: Adicionar lógica para ATUALIZAR (update) caso o usuário já exista (via /start)
      await salvarTriagemNotion({ chatId, nome, renda, fixos, variaveis, poupanca });
      bot.sendMessage(chatId, 'Onboarding finalizado! 🎉\n\nAgora você pode registrar gastos (ex: "gastei 50 no mercado") ou tirar dúvidas financeiras.');
      
      // CRÍTICO: Limpa o usuário da memória
      delete usuariosEmOnboarding[chatId];
      
    } catch (error) {
      console.error("Erro ao salvar triagem no Notion:", error);
      bot.sendMessage(chatId, "Ocorreu um erro ao salvar seus dados. Por favor, tente digitar /start novamente.");
      // Não limpa da memória, deixa ele tentar salvar de novo
    }
  }
  
  return true; // Mensagem tratada
}

// Não exportamos mais a variável 'usuarios'
module.exports = { handleOnboarding };