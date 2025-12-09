require('dotenv').config();
const axios = require('axios');
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- LISTA DE MODELOS (PRIORIDADE -> BACKUP) ---
// Se o primeiro estiver lotado (429), ele tenta o próximo.
const MODELOS_DISPONIVEIS = [
  "nvidia/nemotron-nano-9b-v2:free",      // 1ª Tentativa: Melhor inteligência
  "nvidia/nemotron-nano-12b-v2-vl:free", // 2ª Tentativa: Rápido e estável
  "google/gemma-3-27b-it:free" // 3ª Tentativa: Backup final
];

async function chamarOpenRouter(messages, jsonMode = false) {
  let lastError = null;
  for (const model of MODELOS_DISPONIVEIS) {
    try {
      const payload = { model: model, messages: messages };
      if (jsonMode && model.includes('gemini')) {
        payload.response_format = { type: "json_object" };
      }
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://telegram-bot.com',
          'X-Title': 'FinanceBot'
        },
        timeout: 20000 
      });
      return response.data.choices?.[0]?.message?.content; 
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
// ---------------------------------------------------------


/**
 * SEU PROMPT ORIGINAL FOI RESTAURADO AQUI EMBAIXO
 */
async function handlePerguntaIA(bot, chatId, texto, dadosUsuario) {
  bot.sendChatAction(chatId, 'typing');
  try {
    const resumoFinanceiro = await gerarResumoFinanceiro(chatId);
    const gastosDetalhados = await buscarGastosDetalhados(chatId); 

    // --- 2. SEU CONTEXTO DE DADOS (CÓPIA FIEL) ---
    let contextoDados = "## Contexto do Usuário ##\n";
    
    if (dadosUsuario) {
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

      const disponivelEsteMes = renda - gastosFixos - resumoFinanceiro.totalGastoMesAtual - metaPoupanca;
      contextoDados += `Dinheiro Disponível (Renda - Fixos - Variáveis - Meta Poupança): R$ ${disponivelEsteMes.toFixed(2)}\n`;

      if (gastosDetalhados && gastosDetalhados.length > 0) {
        contextoDados += "\nÚltimos 3 gastos registrados:\n";
        gastosDetalhados.slice(0, 3).forEach(g => {
          contextoDados += `- ${g.data}: ${g.descricao} (Categoria: ${g.categoria}) - R$ ${g.valor.toFixed(2)}\n`;
        });
      }
    } else {
      contextoDados = "O usuário ainda não finalizou o onboarding. Responda apenas à pergunta dele de forma geral, sem usar dados pessoais. Se ele perguntar sobre os gastos dele, diga que ele precisa se cadastrar com /start primeiro.";
    }

    // --- 3. SEU PROMPT DA ATENA (CÓPIA FIEL) ---
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

    // AQUI É A ÚNICA MUDANÇA: Usamos a função de retry em vez do axios direto
    let resposta = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: `${contextoDados}\n\nPERGUNTA DO USUÁRIO:\n"${texto}"` }
    ]);

    resposta = resposta.replace(/<.*?>/g, '').trim();
    bot.sendMessage(chatId, resposta);
    return true;

  } catch (error) {
    console.error('Erro detalhado IA:', error?.response?.data || error);
    bot.sendMessage(chatId, 'Amiga, a conexão falhou aqui rapidinho. Tenta de novo?');
    return true;
  }
}

/**
 * MANTIVE ESTA FUNÇÃO NOVA APENAS PARA O CSV FUNCIONAR (PARCELAS/JSON)
 * ELA NÃO TEM PERSONALIDADE, É SÓ UM EXTRATOR DE DADOS TÉCNICO.
 */
async function analisarGastoComIA(descricao) {
  const systemPrompt = `
      Você é um motor de processamento de despesas. Extraia JSON estrito.
      Categorias: [Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro]
      Métodos: [Crédito, Débito, Pix, Dinheiro, Boleto, Outro]
      Regras:
      1. Extraia o valor (number).
      2. Extraia parcelas (number, default 1). Se disser "3x", são 3 parcelas.
      3. "Mercado/Comida" -> Alimentação. "Uber/Gasolina" -> Transporte.
      
      Retorne APENAS JSON: {"categoria": "String", "valor": Number, "tipoPagamento": "String", "parcelas": Number, "descricao_formatada": "String", "is_gasto": Boolean}
      `;

  try {
    let content = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise: "${descricao}"` }
    ], true);

    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) content = jsonMatch[0];
    return JSON.parse(content);
  } catch (error) {
    return { is_gasto: false };
  }
}

module.exports = { handlePerguntaIA, analisarGastoComIA };