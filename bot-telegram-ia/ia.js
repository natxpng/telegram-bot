require('dotenv').config();
const axios = require('axios');
const { buscarDadosUsuarioNotion, buscarGastosDetalhados } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function limitarResposta(resposta, maxFrases = 4) {
  const frases = resposta.split(/(?<=[.!?])\s+/);
  return frases.slice(0, maxFrases).join(' ');
}

async function handlePerguntaIA(bot, chatId, texto) {
  bot.sendChatAction(chatId, 'typing');
  try {
    let dadosNotion = await buscarDadosUsuarioNotion(chatId);
    let gastosDetalhados = await buscarGastosDetalhados(chatId);

    let contexto = '';
    if (dadosNotion) {
      contexto += `Nome: ${dadosNotion['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário'}. Renda: R$ ${dadosNotion['Renda Mensal']?.number || 'não informada'}. Fixos: R$ ${dadosNotion['Gastos Fixos']?.number || 'não informados'}. Variáveis: R$ ${dadosNotion['Gastos Variáveis']?.number || 'não informados'}. Poupança: R$ ${dadosNotion['Meta de Poupança']?.number || 'não informada'}.`;
    }
    if (gastosDetalhados.length > 0) {
      contexto += ` Últimos gastos:`;
      gastosDetalhados.slice(-3).forEach(g => {
        contexto += ` ${g.descricao} (${g.categoria}) - R$ ${g.valor.toFixed(2)} via ${g.tipoPagamento}.`;
      });
    }
    contexto += ` Responda de forma curta, amigável, sem markdown ou formatação especial. Seja breve, com até 4 frases.`;

    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "deepseek/deepseek-chat-v3.1:free",
      messages: [
        { role: "system", content: contexto },
        { role: "user", content: texto }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let resposta = respostaIA.data.choices?.[0]?.message?.content || "Desculpe, não consegui responder.";
    resposta = limitarResposta(resposta, 4);
    bot.sendMessage(chatId, resposta);
    return true;
  } catch (error) {
    console.error('Erro detalhado IA:', error?.response?.data || error);
    bot.sendMessage(chatId, 'Ocorreu um erro ao tentar acessar a IA. Veja detalhes no log do servidor.');
    return true;
  }
}

module.exports = { handlePerguntaIA };