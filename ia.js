require('dotenv').config();
const axios = require('axios');
const { buscarGastosDetalhados } = require('./notion'); // 'buscarDadosUsuarioNotion' não é mais necessário aqui
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Processa uma pergunta de formato livre do usuário usando a IA.
 * Agora recebe 'dadosUsuario' do server.js
 */
async function handlePerguntaIA(bot, chatId, texto, dadosUsuario) {
  bot.sendChatAction(chatId, 'typing');
  try {
    // Usa os dados que vieram do server.js
    let dadosNotion = dadosUsuario; 
    // Gastos ainda precisam ser buscados (ou poderiam ser passados também, se necessário)
    let gastosDetalhados = await buscarGastosDetalhados(chatId); 

    // 2. CRIE O CONTEXTO DE DADOS
    let contextoDados = "";
    
    if (dadosNotion) {
      // Usuário cadastrado, monta o contexto completo
      contextoDados = "Aqui estão os dados do usuário:\n";
      contextoDados += `- Nome: ${dadosNotion['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário'}\n`;
      contextoDados += `- Renda Mensal: R$ ${dadosNotion['Renda Mensal']?.number || 'não informada'}\n`;
      contextoDados += `- Gastos Fixos: R$ ${dadosNotion['Gastos Fixos']?.number || 'não informados'}\n`;
      contextoDados += `- Meta de Poupança: R$ ${dadosNotion['Meta de Poupança']?.number || 'não informada'}\n`;

      if (gastosDetalhados && gastosDetalhados.length > 0) {
        contextoDados += "\nÚltimos 3 gastos registrados:\n";
        gastosDetalhados.slice(0, 3).forEach(g => {
          contextoDados += `- ${g.descricao} (${g.categoria}) - R$ ${g.valor.toFixed(2)}\n`;
        });
      }
    } else {
      // Usuário NOVO. A IA não terá contexto.
      contextoDados = "O usuário ainda não finalizou o onboarding. Responda apenas à pergunta dele de forma geral, sem usar dados pessoais. Se ele perguntar sobre os gastos dele, diga que ele precisa se cadastrar com /start primeiro.";
    }

    // 3. DEFINA A PERSONALIDADE E REGRAS
    const systemPrompt = `
Você é o "FinBot", um assistente financeiro amigável e direto. 
Seu objetivo é ajudar o usuário a controlar seus gastos.
REGRAS OBRIGATÓRIAS:
1. Responda sempre em português do Brasil.
2. Seja amigável, mas profissional.
3. Suas respostas devem ser CURTAS, com no máximo 4 frases.
4. NUNCA use markdown, negrito, itálico ou formatação especial. Responda apenas com texto puro.
5. Baseie suas respostas nos dados do usuário (se fornecidos).
6. Se o usuário perguntar algo não relacionado a finanças, diga educadamente que você só pode ajudar com tópicos financeiros.
`;

    // 4. MONTE A CHAMADA
    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "deepseek/deepseek-chat-v3.1:free",
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `${contextoDados}\n\nPERGUNTA DO USUÁRIO:\n"${texto}"` 
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let resposta = respostaIA.data.choices?.[0]?.message?.content || "Desculpe, não consegui responder.";
    bot.sendMessage(chatId, resposta);
    return true;

  } catch (error) {
    console.error('Erro detalhado IA:', error?.response?.data || error);
    bot.sendMessage(chatId, 'Ocorreu um erro ao tentar acessar a IA. Veja detalhes no log do servidor.');
    return true;
  }
}

/**
 * Usa a IA para classificar a descrição de um gasto em uma categoria.
 * (Esta função não muda)
 */
async function categorizarGasto(descricao) {
  const systemPrompt = `
      Você é um classificador de despesas. Sua única função é retornar a categoria correta para a despesa.
      Responda APENAS com UMA das seguintes palavras: 
      Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro
      `;
  try {
    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "deepseek/deepseek-chat-v3.1:free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Descrição da despesa: "${descricao}"` }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let categoria = respostaIA.data.choices?.[0]?.message?.content.trim() || "Outro";
    const categoriasValidas = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Educação', 'Compras', 'Dívidas', 'Outro'];
    if (!categoriasValidas.includes(categoria)) {
      return "Outro";
    }
    return categoria;

  } catch (error) {
    console.error('Erro ao categorizar:', error);
    return 'Outro';
  }
}

module.exports = { handlePerguntaIA, categorizarGasto };