require('dotenv').config();
const { salvarGastoNotion, buscarGastosDetalhados } = require('./notion');
const { gerarGraficoBonito } = require('./grafico');
const { categorizarGasto } = require('./ia');

/**
 * Lida com o registro de um novo gasto.
 * Agora recebe 'dadosUsuario' do server.js
 */
async function handleGasto(bot, chatId, texto, dadosUsuario) {
  const regexGasto = /(comprei|gastei|paguei|usei|passei|enviei|transferi|paguei)\s*(.*?)(no cartão|no dinheiro|no pix|no débito|no crédito)?\s*(por|de|=)?\s*(\d+[,.]?\d*)/i;
  const match = texto.match(regexGasto);

  if (match) {
    // MUDANÇA: Checa se o usuário está cadastrado
    if (!dadosUsuario) {
      bot.sendMessage(chatId, "Para registrar um gasto, você precisa primeiro se cadastrar. Digite /start para começar.");
      return true; // Mensagem tratada
    }

    bot.sendChatAction(chatId, 'typing');
    const valor = parseFloat(match[5].replace(',', '.'));
    const descricao = match[2]?.trim() || texto;
    const tipoPagamento = match[3]?.replace('no ', '')?.trim() || 'Outro';
    const data = new Date().toISOString().split('T')[0];

    // Usa o nome que já veio do server.js
    const nome = dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário';

    const categoria = await categorizarGasto(descricao); 
    
    await salvarGastoNotion({
      chatId, nome, data, descricao, valor, tipoPagamento, categoria
    });

    bot.sendMessage(chatId, `Gasto registrado: ${descricao} (Categoria: ${categoria}) - R$ ${valor.toFixed(2)}`);
    return true;
  }
  return false;
}

/**
 * Lida com o comando /gastos para resumir o total.
 */
async function handleResumoGastos(bot, chatId, texto) {
  if (texto === '/gastos') {
    bot.sendChatAction(chatId, 'typing');
    const gastosDetalhados = await buscarGastosDetalhados(chatId);
    const total = (gastosDetalhados || []).reduce((acc, g) => acc + (g.valor || 0), 0);
    
    bot.sendMessage(chatId, `Total de gastos registrados: R$ ${total.toFixed(2)}`);
    return true;
  }
  return false;
}

/**
 * Lida com o comando /grafico.
 */
async function handleGrafico(bot, chatId, texto) {
  if (texto === '/grafico') {
    bot.sendMessage(chatId, 'Gerando gráfico, aguarde...');
    try {
      const imgBuffer = await gerarGraficoBonito(chatId);
      await bot.sendPhoto(chatId, imgBuffer, { caption: 'Gastos por categoria' });
    } catch (err) {
      console.error('Erro ao gerar gráfico:', err);
      bot.sendMessage(chatId, 'Não foi possível gerar o gráfico. Você já registrou algum gasto?');
    }
    return true;
  }
  return false;
}

module.exports = { handleGasto, handleResumoGastos, handleGrafico };