require('dotenv').config();
const { salvarGastoNotion, buscarGastosDetalhados } = require('./notion');
const { categorizarGasto } = require('./ia');

/**
 * Lida com o registro de um novo gasto.
 * Recebe 'nome' (string) do server.js
 */
async function handleGasto(bot, chatId, texto, nome) {
  const regexGasto = /(comprei|gastei|paguei|usei|passei|enviei|transferi|paguei)\s*(.*?)(no cartão|no dinheiro|no pix|no débito|no crédito)?\s*(por|de|=)?\s*(\d+[,.]?\d*)/i;
  const match = texto.match(regexGasto);

  if (match) {
    // Checa se o nome foi fornecido (indicador de onboarding completo)
    if (!nome) {
      return false; // Deixa para o server.js pedir o nome
    }

    bot.sendChatAction(chatId, 'typing');
    const valor = parseFloat(match[5].replace(',', '.'));
    const descricao = match[2]?.trim() || texto;
    const tipoPagamento = match[3]?.replace('no ', '')?.trim() || 'Outro';
    const data = new Date().toISOString().split('T')[0];

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
async function handlePerguntaGastos(bot, chatId, texto) {
  const txt = texto.toLowerCase();
  const perguntasSemana = [
    'gastos da semana',
    'meus gastos da semana',
    'gastei essa semana',
    'gastos semanais'
  ];
  const perguntasMes = [
    'gastos do mês',
    'meus gastos do mês',
    'gastei este mês',
    'gastos mensais'
  ];
  const perguntasGeral = [
    'com o que já gastei',
    'em que já gastei',
    'meus gastos',
    'o que já gastei',
    'listar gastos'
  ];

  const gastosDetalhados = await buscarGastosDetalhados(chatId);
  if (!Array.isArray(gastosDetalhados) || gastosDetalhados.length === 0) {
    bot.sendMessage(chatId, 'Você ainda não registrou nenhum gasto.');
    return true;
  }

  if (perguntasSemana.some(p => txt.includes(p))) {
    const hoje = new Date();
    const primeiroDiaSemana = new Date(hoje);
    primeiroDiaSemana.setDate(hoje.getDate() - hoje.getDay());
    const gastosSemana = gastosDetalhados.filter(g => new Date(g.data) >= primeiroDiaSemana);
    if (gastosSemana.length === 0) {
      bot.sendMessage(chatId, 'Você não teve gastos registrados nesta semana.');
      return true;
    }
    const lista = gastosSemana.map(g => `- ${g.data}: ${g.descricao} (R$ ${g.valor.toFixed(2)})`).join('\n');
    bot.sendMessage(chatId, `Seus gastos da semana:\n${lista}`);
    return true;
  }

  if (perguntasMes.some(p => txt.includes(p))) {
    const hoje = new Date();
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const gastosMes = gastosDetalhados.filter(g => new Date(g.data) >= primeiroDiaMes);
    if (gastosMes.length === 0) {
      bot.sendMessage(chatId, 'Você não teve gastos registrados neste mês.');
      return true;
    }
    const lista = gastosMes.map(g => `- ${g.data}: ${g.descricao} (R$ ${g.valor.toFixed(2)})`).join('\n');
    bot.sendMessage(chatId, `Seus gastos do mês:\n${lista}`);
    return true;
  }

  if (perguntasGeral.some(p => txt.includes(p))) {
    const lista = gastosDetalhados.map(g => `- ${g.data}: ${g.descricao} (R$ ${g.valor.toFixed(2)})`).join('\n');
    bot.sendMessage(chatId, `Seus gastos registrados:\n${lista}`);
    return true;
  }
  return false;
}

/**
 * Wrapper que redireciona para handlePerguntaGastos
 * (mantém compatibilidade com o novo server.js)
 */
async function handleResumoGastos(bot, chatId, texto) {
  return await handlePerguntaGastos(bot, chatId, texto);
}

module.exports = { handleGasto, handleResumoGastos, handlePerguntaGastos };