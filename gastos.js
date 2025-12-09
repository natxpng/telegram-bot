require('dotenv').config();
const { salvarGastoNotion, buscarGastosDetalhados } = require('./notion');
const { gerarGraficoBonito } = require('./grafico');
// CORREÇÃO AQUI: Importamos a função que sabe ler parcelas e estruturar dados
const { analisarGastoComIA } = require('./ia'); 

/**
 * Lida com o registro de um novo gasto.
 */
async function handleGasto(bot, chatId, texto, dadosUsuario) {
  // 1. MANTEMOS O REGEX (O Porteiro)
  // Isso garante que o bot continue separando o que é conversa do que é gasto.
  const regexGasto = /(comprei|gastei|paguei|usei|passei|enviei|transferi|paguei)\s*(.*?)(no cartão|no dinheiro|no pix|no débito|no crédito)?\s*(por|de|=)?\s*(\d+[,.]?\d*)/i;
  const match = texto.match(regexGasto);

  if (match) {
    if (!dadosUsuario) {
      bot.sendMessage(chatId, "Para registrar um gasto, você precisa primeiro se cadastrar. Digite /start para começar.");
      return true; 
    }

    bot.sendChatAction(chatId, 'typing');

    // 2. CORREÇÃO DO REGISTRO:
    // Chamamos a IA para limpar os dados, detectar parcelas e categoria correta.
    const dadosIA = await analisarGastoComIA(texto);

    // Fallback: Se a IA falhar em achar o valor, usamos o do Regex.
    const valorFinal = dadosIA.valor > 0 ? dadosIA.valor : parseFloat(match[5].replace(',', '.'));
    const descricaoFinal = dadosIA.descricao_formatada || match[2]?.trim() || texto;
    const categoria = dadosIA.categoria || "Outro";
    const tipoPagamento = dadosIA.tipoPagamento || (match[3]?.replace('no ', '')?.trim() || 'Outro');
    const parcelas = dadosIA.parcelas || 1;
    
    const nome = dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário';

    // 3. LÓGICA DE PARCELAMENTO (Isso arruma o CSV)
    if (parcelas > 1) {
       const valorParcela = valorFinal / parcelas;
       bot.sendMessage(chatId, `🔄 Registrando parcelado em ${parcelas}x de R$${valorParcela.toFixed(2)}...`);
       
       for (let i = 0; i < parcelas; i++) {
          const dataParcela = new Date();
          dataParcela.setMonth(dataParcela.getMonth() + i); // Joga para os meses seguintes
          
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
       bot.sendMessage(chatId, `✅ Compra parcelada salva com sucesso!`);

    } else {
       // À VISTA (Salvamento padrão)
       await salvarGastoNotion({
         chatId, 
         nome, 
         data: new Date().toISOString().split('T')[0], 
         descricao: descricaoFinal, 
         valor: valorFinal, 
         tipoPagamento: tipoPagamento, 
         categoria: categoria
       });
       bot.sendMessage(chatId, `✅ Gasto de R$ ${valorFinal.toFixed(2)} registrado em ${categoria}.`);
    }

    return true; // Impede que a Atena responda isso como chat
  }
  return false; // Se não for gasto, deixa passar para o chat
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