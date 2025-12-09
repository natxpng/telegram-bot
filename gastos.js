require('dotenv').config();
const { salvarGastoNotion, buscarGastosDetalhados } = require('./notion');
const { gerarGraficoBonito } = require('./grafico');
// IMPORTANTE: Trocamos categorizarGasto por analisarGastoComIA para resolver o BUG DO CSV
const { analisarGastoComIA } = require('./ia'); 

async function handleGasto(bot, chatId, texto, dadosUsuario) {
  // --- SUA LÓGICA DE REGEX RESTAURADA ---
  const regexGasto = /(comprei|gastei|paguei|usei|passei|enviei|transferi|paguei)\s*(.*?)(no cartão|no dinheiro|no pix|no débito|no crédito)?\s*(por|de|=)?\s*(\d+[,.]?\d*)/i;
  const match = texto.match(regexGasto);

  if (match) {
    // Checagem de usuário
    if (!dadosUsuario) {
      bot.sendMessage(chatId, "Para registrar um gasto, você precisa primeiro se cadastrar. Digite /start para começar.");
      return true; 
    }

    bot.sendChatAction(chatId, 'typing');

    // --- AQUI ESTÁ A CORREÇÃO DO CSV ---
    // Mesmo detectando com Regex, pedimos para a IA limpar os dados (JSON)
    // para pegar as PARCELAS e a CATEGORIA certa que estavam falhando.
    const dadosIA = await analisarGastoComIA(texto);

    // Fallback: Se a IA falhar, usamos o que o Regex pegou
    const valorFinal = dadosIA.valor > 0 ? dadosIA.valor : parseFloat(match[5].replace(',', '.'));
    const descricaoFinal = dadosIA.descricao_formatada || match[2]?.trim() || texto;
    const categoria = dadosIA.categoria || "Outro";
    const tipoPagamento = dadosIA.tipoPagamento || (match[3]?.replace('no ', '')?.trim() || 'Outro');
    const parcelas = dadosIA.parcelas || 1;
    
    const nome = dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário';

    // --- LÓGICA DE PARCELAS (ESSENCIAL PARA O CSV FICAR CERTO) ---
    if (parcelas > 1) {
       const valorParcela = valorFinal / parcelas;
       bot.sendMessage(chatId, `🔄 Registrando parcelado em ${parcelas}x...`);
       
       for (let i = 0; i < parcelas; i++) {
          const dataParcela = new Date();
          dataParcela.setMonth(dataParcela.getMonth() + i);
          
          await salvarGastoNotion({
            chatId, nome, 
            data: dataParcela.toISOString().split('T')[0], 
            descricao: `${descricaoFinal} (${i+1}/${parcelas})`, 
            valor: valorParcela, 
            tipoPagamento: tipoPagamento, 
            categoria: categoria
          });
       }
       bot.sendMessage(chatId, `✅ Compra parcelada salva com sucesso!`);
    } else {
       // À VISTA
       await salvarGastoNotion({
         chatId, nome, 
         data: new Date().toISOString().split('T')[0], 
         descricao: descricaoFinal, 
         valor: valorFinal, 
         tipoPagamento: tipoPagamento, 
         categoria: categoria
       });
       bot.sendMessage(chatId, `Gasto registrado: ${descricaoFinal} (Categoria: ${categoria}) - R$ ${valorFinal.toFixed(2)}`);
    }

    return true;
  }
  return false;
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