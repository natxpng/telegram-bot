require('dotenv').config();
const axios = require('axios');
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Processa uma pergunta de formato livre do usuário (Chatbot).
 */
async function handlePerguntaIA(bot, chatId, texto, dadosUsuario) {
  bot.sendChatAction(chatId, 'typing');
  try {
    const resumoFinanceiro = await gerarResumoFinanceiro(chatId);
    const gastosDetalhados = await buscarGastosDetalhados(chatId); 
    
    let contextoDados = "## Contexto do Usuário ##\n";
    
    if (dadosUsuario) {
      const renda = dadosUsuario['Renda Mensal']?.number || 0;
      const metaPoupanca = dadosUsuario['Meta de Poupança']?.number || 0;
      const gastosFixos = dadosUsuario['Gastos Fixos']?.number || 0;
      
      contextoDados += `Nome: ${dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário'}\n`;
      contextoDados += `Renda Mensal: R$ ${renda.toFixed(2)}\n`;
      contextoDados += `\n## Situação Mês Atual ##\n`;
      contextoDados += `Total Gasto no Mês (Variáveis): R$ ${resumoFinanceiro.totalGastoMesAtual.toFixed(2)}\n`;
      
      const disponivelEsteMes = renda - gastosFixos - resumoFinanceiro.totalGastoMesAtual - metaPoupanca;
      contextoDados += `Dinheiro Disponível Hoje: R$ ${disponivelEsteMes.toFixed(2)}\n`;

      if (gastosDetalhados && gastosDetalhados.length > 0) {
        contextoDados += "\nÚltimos 3 gastos registrados:\n";
        gastosDetalhados.slice(0, 3).forEach(g => {
          contextoDados += `- ${g.data}: ${g.descricao} (Categoria: ${g.categoria}) - R$ ${g.valor.toFixed(2)}\n`;
        });
      }
    } else {
      contextoDados = "O usuário ainda não finalizou o onboarding.";
    }

    const systemPrompt = `
    Você é a "Atena", assistente financeira pessoal.
    Personalidade: Amiga, casual, feminina e direta.
    Objetivo: Ajudar a controlar gastos sem julgar.
    
    Contexto Atual:
    ${contextoDados}

    Se o usuário perguntar sobre gastos, use os dados acima.
    Responda sempre em texto corrido, sem Markdown, sem negrito.
    `;

    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "google/gemma-3-27b-it:free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: texto }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let resposta = respostaIA.data.choices?.[0]?.message?.content || "Desculpe, não entendi.";
    // Limpeza de tokens de sistema que as vezes vazam
    resposta = resposta.replace(/<.*?>/g, '').trim();
    
    bot.sendMessage(chatId, resposta);
    return true;

  } catch (error) {
    console.error('Erro IA Chat:', error.message);
    bot.sendMessage(chatId, 'Estou com um pouco de sono agora (Erro na IA). Tente já já.');
    return true;
  }
}

/**
 * NOVA FUNÇÃO PODEROSA: Extrai JSON estruturado do gasto.
 * Resolve o problema de parcelas e categorias erradas.
 */
async function analisarGastoComIA(descricao) {
  const systemPrompt = `
      Você é um motor de processamento de despesas bancárias.
      Sua tarefa é ler a frase do usuário e extrair um JSON estrito.

      Categorias permitidas: [Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro]
      Métodos permitidos: [Crédito, Débito, Pix, Dinheiro, Boleto, Outro]

      Regras:
      1. Se mencionar "x" ou "vezes" (ex: 3x, 3 vezes), extraia o número de parcelas.
      2. Identifique o valor monetário.
      3. Identifique o método (Uber/Ifood geralmente é Crédito se não especificado).
      4. "Mercado", "Comida", "Lanche" -> Alimentação.
      5. "Uber", "Gasolina", "99" -> Transporte.

      Retorne APENAS o JSON neste formato:
      {
        "categoria": "String",
        "valor": Number (use ponto para decimais, ex: 30.50),
        "tipoPagamento": "String",
        "parcelas": Number (padrao 1),
        "descricao_formatada": "String (ex: Mercado Semanal)",
        "is_gasto": Boolean (true se for um gasto, false se for conversa aleatória)
      }
      `;

  try {
    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      // Usamos o Gemini 2.0 Flash pois ele obedece JSON melhor que o Gemma
      model: "google/gemini-2.0-flash-exp:free", 
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise: "${descricao}"` }
      ],
      response_format: { type: "json_object" } 
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let content = respostaIA.data.choices?.[0]?.message?.content;
    // Limpeza garantida para JSON
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(content);

  } catch (error) {
    console.error('Erro ao analisar JSON do gasto:', error.message);
    // Retorna um objeto de erro seguro
    return { is_gasto: false };
  }
}

module.exports = { handlePerguntaIA, analisarGastoComIA };