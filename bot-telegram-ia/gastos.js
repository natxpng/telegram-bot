require('dotenv').config();
const { salvarGastoNotion } = require('./notion');
const { gerarGraficoBonito } = require('./grafico');
const { usuarios } = require('./onboarding');

const gastos = {};

async function handleGasto(bot, chatId, texto) {
  if (!gastos[chatId]) gastos[chatId] = [];
  const regexGasto = /(comprei|gastei|paguei|usei|passei|enviei|transferi|paguei)\s*(.*?)(no cartão|no dinheiro|no pix|no débito|no crédito)?\s*(por|de|=)?\s*(\d+[,.]?\d*)/i;
  const match = texto.match(regexGasto);
  if (match) {
    const valor = parseFloat(match[5].replace(',', '.'));
    const descricao = match[2]?.trim() || texto;
    const tipoPagamento = match[3]?.replace('no ', '')?.trim() || 'Outro';
    const data = new Date().toISOString().split('T')[0];
    const categoria = 'Não categorizado';
    gastos[chatId].push({ descricao, valor, tipoPagamento, data });
    let nome = usuarios[chatId]?.respostas?.[0] || '';
    await salvarGastoNotion({
      chatId,
      nome,
      data,
      descricao,
      valor,
      tipoPagamento,
      categoria
    });
    bot.sendMessage(chatId, `Gasto registrado: ${descricao} - R$ ${valor.toFixed(2)} (${tipoPagamento})`);
    return true;
  }
  return false;
}

async function handleResumoGastos(bot, chatId, texto) {
  if (texto === '/gastos') {
    const total = (gastos[chatId] || []).reduce((acc, g) => acc + g.valor, 0);
    bot.sendMessage(chatId, `Total de gastos registrados: R$ ${total.toFixed(2)}`);
    return true;
  }
  return false;
}

async function handleGrafico(bot, chatId, texto) {
  if (texto === '/grafico') {
    bot.sendMessage(chatId, 'Gerando gráfico, aguarde...');
    try {
      const imgBuffer = await gerarGraficoBonito(chatId);
      await bot.sendPhoto(chatId, imgBuffer, { caption: 'Gastos por categoria' });
    } catch (err) {
      console.error('Erro ao gerar gráfico:', err);
      bot.sendMessage(chatId, 'Não foi possível gerar o gráfico.');
    }
    return true;
  }
  return false;
}

module.exports = { handleGasto, handleResumoGastos, handleGrafico };
