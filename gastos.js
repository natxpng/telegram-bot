require('dotenv').config();
const { salvarGastoNotion, buscarGastosDetalhados } = require('./notion');
const { gerarGraficoBonito } = require('./grafico');
const { analisarGastoComIA } = require('./ia'); 

async function handleGasto(bot, chatId, texto, dadosUsuario) {
  // [DEBUG] Log para confirmar que a mensagem chegou aqui
  console.log(`[DEBUG GASTOS] Mensagem recebida: "${texto}"`);

  // Regex "Porteiro"
  const regexGasto = /(comprei|gastei|paguei|usei|passei|enviei|transferi|paguei)\s*(.*?)(no cartão|no dinheiro|no pix|no débito|no crédito)?\s*(por|de|=)?\s*(\d+[,.]?\d*)/i;
  const match = texto.match(regexGasto);

  if (match) {
    console.log(`[DEBUG GASTOS] Regex: APROVADO. Iniciando análise com IA...`);

    if (!dadosUsuario) {
      bot.sendMessage(chatId, "Para registrar um gasto, você precisa primeiro se cadastrar. Digite /start para começar.");
      return true; 
    }

    bot.sendChatAction(chatId, 'typing');

    // Chama a IA e aguarda o JSON limpo
    const dadosIA = await analisarGastoComIA(texto);
    
    console.log(`[DEBUG GASTOS] Retorno final da IA para salvamento:`, JSON.stringify(dadosIA));

    // Fallback de segurança (se a IA falhar no valor, pega do Regex)
    const valorFinal = dadosIA.valor > 0 ? dadosIA.valor : parseFloat(match[5].replace(',', '.'));
    const descricaoFinal = dadosIA.descricao_formatada || match[2]?.trim() || texto;
    const categoria = dadosIA.categoria || "Outro"; // Aqui já deve vir corrigido do ia.js
    const tipoPagamento = dadosIA.tipoPagamento || (match[3]?.replace('no ', '')?.trim() || 'Outro');
    const parcelas = dadosIA.parcelas || 1;
    
    const nome = dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário';

    // Lógica de Parcelamento
    if (parcelas > 1) {
       const valorParcela = valorFinal / parcelas;
       bot.sendMessage(chatId, `🔄 Parcelando em ${parcelas}x de R$${valorParcela.toFixed(2)}...`);
       
       for (let i = 0; i < parcelas; i++) {
          const dataParcela = new Date();
          dataParcela.setMonth(dataParcela.getMonth() + i);
          
          await salvarGastoNotion({
            chatId, 
            nome, 
            data: dataParcela.toISOString().split('T')[0], 
            descricao: `${descricaoFinal} (${i+1}/${parcelas})`, 
            valor: valorParcela, 
            tipoPagamento: tipoPagamento, 
            categoria: categoria
          });
       }
       bot.sendMessage(chatId, `✅ Parcelamento registrado em: ${categoria}`);

    } else {
       // À VISTA
       await salvarGastoNotion({
         chatId, 
         nome, 
         data: new Date().toISOString().split('T')[0], 
         descricao: descricaoFinal, 
         valor: valorFinal, 
         tipoPagamento: tipoPagamento, 
         categoria: categoria
       });
       bot.sendMessage(chatId, `✅ Gasto de R$ ${valorFinal.toFixed(2)} registrado em: ${categoria}`);
    }

    return true; // Mensagem processada, não vai para o chat
  } 
  
  console.log(`[DEBUG GASTOS] Regex: REPROVADO (Não é comando de gasto). Passando para Atena.`);
  return false; // Retorna false para ativar a Atena (Chat)
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
      bot.sendMessage(chatId, 'Não foi possível gerar o gráfico.');
    }
    return true;
  }
  return false;
}

module.exports = { handleGasto, handleResumoGastos, handleGrafico };