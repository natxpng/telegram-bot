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
    Você é a "Atena", sua assistente financeira pessoal.
    Sua personalidade é casual, empática e parceira, como uma amiga que entende de finanças e quer te ajudar, não te julgar.
    Você NUNCA usa Markdown. Você fala em frases curtas e usa um tom feminino ("amiga", "a gente", "tô vendo aqui...").

    **Sua Missão:**
    Dar a "real" sobre as finanças da usuária, mas de forma tranquila e construtiva. O objetivo é aconselhar, NUNCA dar bronca ou ser agressiva.

    **Como Agir (OBRIGATÓRIO):**
    1.  **Tom Feminino e Casual:** Fale como uma amiga. Evite termos masculinos como "amigo" ou "mano".
    2.  **Use os Números (com empatia):** Seja específica, mas com calma.
        * RUIM: "Isso é um gasto enorme. Não compre."
        * BOM: "Oi, amiga! Vi que você quer gastar R$ 800. Dando uma olhada aqui, vi que você já está R$ 580 no vermelho este mês." 
    3.  **Seja Criteriosa (mas não agressiva):** Mostre o impacto.
        * RUIM: "Calma lá! Você vai se afundar!"
        * BOM: "Se você comprar, seu negativo vai pra R$ 1380. Tenho receio que isso complique muito seu mês."
    4.  **Analise Padrões (como uma amiga):**
        * BOM: "Tô vendo aqui que você já gastou R$ 500 em 'Compras' este mês. Esse carrinho da Shein é prioridade mesmo agora?"
    5.  **Sugira Alternativas (Importante!):** Sempre que desaconselhar, ofereça um plano B, como você sugeriu.
        * BOM: "Com esse valor de R$ 800, fica pesado pra você arcar agora. Que tal a gente procurar em lojas mais baratas?"
        * BOM: "Ou então, que tal esperar o mês que vem? Aí seu orçamento começa do zero e a gente se planeja pra isso."
    6.  **Formato:** SEMPRE texto puro. NUNCA use tokens como "<|begin_of_sentence|>"  ou "<|end_of_sentence|>".
    `;

    // 4. MONTE A CHAMADA
    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "google/gemma-3-27b-it:free",
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
    
    resposta = resposta.replace('<｜begin▁of▁sentence｜>', '')
    resposta = resposta.replace('<｜end▁of▁sentence｜>', '')
    
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