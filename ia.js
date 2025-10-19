require('dotenv').config();
const axios = require('axios');
// ADICIONA A NOVA FUNÇÃO DE RESUMO
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Processa uma pergunta de formato livre do usuário usando a IA.
 * Agora recebe 'dadosUsuario' do server.js
 */
async function handlePerguntaIA(bot, chatId, texto, dadosUsuario) {
  bot.sendChatAction(chatId, 'typing');
  try {
    // --- NOVOS DADOS ---
    // Busca o resumo financeiro e os gastos detalhados
    const resumoFinanceiro = await gerarResumoFinanceiro(chatId);
    const gastosDetalhados = await buscarGastosDetalhados(chatId); 
    // ---------------------

    // 2. CRIE O CONTEXTO DE DADOS
    let contextoDados = "## Contexto do Usuário ##\n";
    
    if (dadosUsuario) {
      // Usuário cadastrado, monta o contexto completo
      const renda = dadosUsuario['Renda Mensal']?.number || 0;
      const metaPoupanca = dadosUsuario['Meta de Poupança']?.number || 0;
      const gastosFixos = dadosUsuario['Gastos Fixos']?.number || 0;
      
      contextoDados += `Nome: ${dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário'}\n`;
      contextoDados += `Renda Mensal: R$ ${renda.toFixed(2)}\n`;
      contextoDados += `Gastos Fixos: R$ ${gastosFixos.toFixed(2)}\n`;
      contextoDados += `Meta de Poupança Mensal: R$ ${metaPoupanca.toFixed(2)}\n`;
      contextoDados += `\n## Situação Mês Atual ##\n`;
      contextoDados += `Total Gasto no Mês (Variáveis): R$ ${resumoFinanceiro.totalGastoMesAtual.toFixed(2)}\n`;
      contextoDados += `Gastos por Categoria (Mês Atual): ${JSON.stringify(resumoFinanceiro.categoriasMesAtual)}\n`;

      // Calcula o "dinheiro sobrando"
      const disponivelEsteMes = renda - gastosFixos - resumoFinanceiro.totalGastoMesAtual - metaPoupanca;
      contextoDados += `Dinheiro Disponível (Renda - Fixos - Variáveis - Meta Poupança): R$ ${disponivelEsteMes.toFixed(2)}\n`;

      if (gastosDetalhados && gastosDetalhados.length > 0) {
        contextoDados += "\nÚltimos 3 gastos registrados:\n";
        gastosDetalhados.slice(0, 3).forEach(g => {
          contextoDados += `- ${g.data}: ${g.descricao} (Categoria: ${g.categoria}) - R$ ${g.valor.toFixed(2)}\n`;
        });
      }
    } else {
      // Usuário NOVO.
      contextoDados = "O usuário ainda não finalizou o onboarding. Responda apenas à pergunta dele de forma geral, sem usar dados pessoais. Se ele perguntar sobre os gastos dele, diga que ele precisa se cadastrar com /start primeiro.";
    }

    // --- ESTE É O NOVO PROMPT "TURBINADO" ---
    const systemPrompt = `
Você é o "FinBot", um assistente financeiro especialista, proativo e analítico.

**Sua Missão Principal:**
Você NÃO é um bot de Q&A. Você é um conselheiro. Sua missão é analisar os dados financeiros do usuário (Renda, Gastos, Metas) para fornecer conselhos profundos e personalizados.

**Regras de Análise (OBRIGATÓRIO):**
1.  **Seja Específico:** NUNCA dê conselhos genéricos. Use os números que você recebeu.
    * RUIM: "Isso é um gasto significativo."
    * BOM: "Esse celular de R$ 2000  representa 40% da sua renda de R$ 5000."
2.  **Use o Contexto Total:** Compare o pedido com a renda, a meta de poupança e, o mais importante, o "Dinheiro Disponível".
    * Ex: "Você quer gastar R$ 2000, mas seu 'Dinheiro Disponível' este mês é de apenas R$ 400. Se você comprar, não vai bater sua meta de poupança."
3.  **Procure Padrões (IMPORTANTE):**
    * Se o usuário quer comprar algo, verifique os "Gastos por Categoria (Mês Atual)".
    * Ex: "Notei que você já gastou R$ 500 em 'Compras' este mês. Esse celular seria um gasto adicional nessa categoria."
    * Ex: "Você já comprou 'Fone de Ouvido' semana passada, tem certeza que precisa do celular agora?"
4.  **Sugira Alternativas:**
    * Seja proativo. Se a compra for ruim, sugira um plano.
    * Ex: "Sua meta de poupança é R$ 2500. Se comprar isso, você não vai batê-la. Que tal economizar por mais 2 meses e comprar sem apertar seu orçamento?"
    * Ex: "Percebi que você tem um gasto alto em 'Transporte'. Talvez seja melhor focar nisso antes de uma compra grande."

**Regras de Formato:**
1.  Responda em português do Brasil.
2.  Seja amigável, mas direto e analítico (como um especialista).
3.  NUNCA use markdown. Texto puro.
4.  NUNCA use tokens como "<|begin_of_sentence|>" ou "<|end_of_sentence|>".
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
    
    // Limpeza de tokens que o DeepSeek pode vazar
    resposta = resposta.replace(/<\s*\|\s*begin_of_sentence\s*\|\s*>/g, '').trim();
    resposta = resposta.replace(/<\s*\|\s*end_of_sentence\s*\|\s*>/g, '').trim();

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