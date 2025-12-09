require('dotenv').config();
const axios = require('axios');
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- LISTA DE MODELOS (PRIORIDADE -> BACKUP) ---
// Se o primeiro estiver lotado (429), ele tenta o próximo.
const MODELOS_DISPONIVEIS = [
  "google/gemini-2.0-flash-exp:free",      // 1ª Tentativa: Melhor inteligência
  "meta-llama/llama-3.1-8b-instruct:free", // 2ª Tentativa: Rápido e estável
  "microsoft/phi-3-medium-128k-instruct:free" // 3ª Tentativa: Backup final
];

/**
 * Função auxiliar que tenta vários modelos até um funcionar.
 * Resolve o problema do erro 429 (Too Many Requests).
 */
async function chamarOpenRouter(messages, jsonMode = false) {
  let lastError = null;

  for (const model of MODELOS_DISPONIVEIS) {
    try {
      console.log(`[IA] Tentando modelo: ${model}...`);
      
      const payload = {
        model: model,
        messages: messages,
      };

      // Alguns modelos dão erro se mandarmos response_format: json_object sem suporte
      // Então só mandamos se for o Gemini (que sabemos que suporta bem)
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
        timeout: 15000 // Timeout de 15s para não ficar travado
      });

      return response.data.choices?.[0]?.message?.content; // SUCESSO! Retorna o texto.

    } catch (error) {
      console.warn(`[IA] Falha no modelo ${model}:`, error.response?.status || error.message);
      lastError = error;
      // Continua para a próxima iteração do loop (próximo modelo)
    }
  }
  
  // Se saiu do loop, todos falharam
  throw lastError;
}

/**
 * Processa o Chat (Conversa livre)
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
    Contexto Atual: ${contextoDados}
    Responda em texto corrido, sem Markdown complexo.
    `;

    // CHAMA A FUNÇÃO ROBUSTA
    let resposta = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: texto }
    ]);

    // Limpeza básica
    resposta = resposta.replace(/<.*?>/g, '').trim();
    bot.sendMessage(chatId, resposta);
    return true;

  } catch (error) {
    console.error('Erro IA Chat (Todos os modelos falharam):', error.message);
    bot.sendMessage(chatId, 'Estou meio sobrecarregada agora (Muitos pedidos). Tente daqui a pouco!');
    return true;
  }
}

/**
 * Analisa o gasto e extrai JSON (Com sistema de Retry)
 */
async function analisarGastoComIA(descricao) {
  const systemPrompt = `
      Você é um motor de processamento de despesas.
      Sua tarefa é ler a frase e extrair um JSON estrito.
      
      Categorias: [Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro]
      Métodos: [Crédito, Débito, Pix, Dinheiro, Boleto, Outro]

      Regras:
      1. Extraia o valor (number).
      2. Extraia parcelas (number, default 1). Se disser "3x", são 3 parcelas.
      3. "Mercado/Comida" -> Alimentação. "Uber/Gasolina" -> Transporte.
      
      Retorne APENAS JSON:
      {
        "categoria": "String",
        "valor": Number,
        "tipoPagamento": "String",
        "parcelas": Number,
        "descricao_formatada": "String",
        "is_gasto": Boolean
      }
      `;

  try {
    // CHAMA A FUNÇÃO ROBUSTA (jsonMode = true para tentar forçar JSON onde possível)
    let content = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise: "${descricao}"` }
    ], true);

    // Limpeza agressiva para garantir JSON válido
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Tenta encontrar o JSON dentro do texto se a IA for "fofoqueira" e falar demais
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        content = jsonMatch[0];
    }

    return JSON.parse(content);

  } catch (error) {
    console.error('Erro IA JSON (Todos falharam):', error.message);
    // Retorna erro silencioso para não quebrar o bot
    return { is_gasto: false };
  }
}

module.exports = { handlePerguntaIA, analisarGastoComIA };