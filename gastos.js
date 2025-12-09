require('dotenv').config();
const { salvarGastoNotion, buscarGastosDetalhados } = require('./notion');
const { gerarGraficoBonito } = require('./grafico');
// Importamos a nova função de IA estruturada
const { analisarGastoComIA } = require('./ia'); 

async function handleGasto(bot, chatId, texto, dadosUsuario) {
  // 1. Verificação rápida de comandos para não gastar IA à toa
  if (texto.startsWith('/')) return false;

  // 2. Se o usuário não existe, barra antes
  if (!dadosUsuario) {
     // Deixamos passar false para o fluxo de onboarding ou chat tratar, 
     // ou mandamos o aviso aqui se tiver certeza que é tentativa de gasto.
     // Por segurança, retornamos false para o server.js decidir.
     return false; 
  }

  // 3. O PULO DO GATO: Mandamos para a IA analisar se é gasto
  // Removemos o Regex limitado. A IA decide agora.
  bot.sendChatAction(chatId, 'typing');
  
  const dadosIA = await analisarGastoComIA(texto);

  // Se a IA disse que NÃO é um gasto (ex: "Oi tudo bem"), retornamos false
  // para que a função `handlePerguntaIA` (o chat amigo) responda.
  if (!dadosIA || !dadosIA.is_gasto || dadosIA.valor === 0) {
    return false;
  }

  // --- SE CHEGOU AQUI, É UM GASTO CONFIRMADO ---
  
  const nome = dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário';
  const parcelas = dadosIA.parcelas || 1;
  const valorTotal = dadosIA.valor;
  const valorParcela = valorTotal / parcelas;

  // Lógica de Parcelamento
  if (parcelas > 1) {
    bot.sendMessage(chatId, `🔄 Processando compra parcelada em ${parcelas}x de R$${valorParcela.toFixed(2)}...`);
    
    for (let i = 0; i < parcelas; i++) {
      const dataParcela = new Date();
      dataParcela.setMonth(dataParcela.getMonth() + i); // Soma os meses
      
      const descricaoFinal = `${dadosIA.descricao_formatada} (${i + 1}/${parcelas})`;
      
      await salvarGastoNotion({
        chatId,
        nome,
        data: dataParcela.toISOString().split('T')[0], // YYYY-MM-DD
        descricao: descricaoFinal,
        valor: valorParcela,
        tipoPagamento: dadosIA.tipoPagamento || 'Crédito', // Parcelado vira Crédito por padrão se não vier
        categoria: dadosIA.categoria
      });
    }
    bot.sendMessage(chatId, `✅ Compra parcelada registrada com sucesso!`);

  } else {
    // Compra à vista
    await salvarGastoNotion({
      chatId,
      nome,
      data: new Date().toISOString().split('T')[0],
      descricao: dadosIA.descricao_formatada,
      valor: valorTotal,
      tipoPagamento: dadosIA.tipoPagamento,
      categoria: dadosIA.categoria
    });
    bot.sendMessage(chatId, `✅ Gasto de R$ ${valorTotal.toFixed(2)} registrado em ${dadosIA.categoria}.`);
  }

  return true; // Retorna true para avisar o server.js que a mensagem foi processada
}

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