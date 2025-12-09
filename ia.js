require('dotenv').config();
const axios = require('axios');
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- 1. LISTA DE MODELOS ESTÁVEIS ---
const MODELOS = [
  // Gemini 2.0 Flash: O melhor e mais rápido atualmente no free
  "google/gemini-2.0-flash-exp:free",
  
  // Qwen 2.5 72B: Excelente em português e aceita JSON via prompt
  "qwen/qwen-2.5-72b-instruct:free",
  
  // Llama 3.3 70B: Muito inteligente
  "meta-llama/llama-3.3-70b-instruct:free",
  
  // Backups menores e rápidos
  "google/gemma-2-9b-it:free",
  "mistralai/mistral-nemo:free"
];

// --- 2. CATEGORIAS OFICIAIS ---
const CATEGORIAS_VALIDAS = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Educação', 'Compras', 'Dívidas', 'Outro'];

// --- 3. FUNÇÃO DE CONEXÃO LIMPA (SEM PAYLOADS EXÓTICOS) ---
async function chamarOpenRouter(messages, jsonMode = false) {
  let lastError = null;

  for (const model of MODELOS) {
    try {
      console.log(`[IA] Tentando conectar com: ${model}`);

      // PAYLOAD PADRÃO (O ÚNICO QUE FUNCIONA PRA TODOS)
      const payload = {
        model: model,
        messages: messages,
        temperature: 0.2 // Baixa temperatura para ser mais preciso no JSON
      };

      // CORREÇÃO DO ERRO 400:
      // Só enviamos 'response_format' se for GEMINI. 
      // Qwen, Llama e Mistral DÃO ERRO 400 se receberem isso no free tier.
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
        timeout: 45000 // 45 segundos
      });

      const conteudo = response.data.choices?.[0]?.message?.content;
      
      if (conteudo) {
          console.log(`[IA] Sucesso com ${model}`);
          return conteudo; 
      }

    } catch (error) {
      // Loga o erro curto para não poluir, e tenta o próximo
      const status = error.response ? error.response.status : 'Erro de Rede';
      console.warn(`[IA] Falha no modelo ${model} (Status: ${status}). Tentando próximo...`);
      lastError = error;
    }
  }
  
  console.error('[IA] Todos os modelos falharam.');
  throw lastError;
}

// --- FUNÇÃO DE CHAT (ATENA) ---
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
      contextoDados += `Dinheiro Disponível (Renda - Fixos - Variáveis - Meta Poupança): R$ ${disponivelEsteMes.toFixed(2)}\n`;

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
    Você é a "Atena", uma estrategista financeira pessoal (e amiga sincera).
    
    **Personalidade:**
    - Feminina, casual, direta e inteligente.
    - Você NÃO é um "fiscal" que proíbe tudo. Você é uma facilitadora.

    **REGRAS DE DECISÃO:**
    1. **Regra do Bolso:** Se "Dinheiro Disponível" > compra -> APROVE.
    2. **Timing:** Fim de mês? Sugira esperar o cartão virar.
    3. **Trade-off:** Sugira trocas se estiver apertado.

    **Formato:** Texto curto, sem Markdown, direto ao ponto.
    `;

    let resposta = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: `${contextoDados}\n\nPERGUNTA: "${texto}"` }
    ]);

    resposta = resposta.replace(/<.*?>/g, '').trim();
    bot.sendMessage(chatId, resposta);
    return true;

  } catch (error) {
    console.error('Erro detalhado IA:', error?.message);
    bot.sendMessage(chatId, 'Amiga, a conexão falhou aqui rapidinho. Tenta de novo?');
    return true;
  }
}

// --- FUNÇÃO TÉCNICA (EXTRAÇÃO DE JSON) ---
async function analisarGastoComIA(descricao) {
  const systemPrompt = `
      Você é um motor de processamento de despesas.
      Categorias Válidas: [Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro]
      Métodos: [Crédito, Débito, Pix, Dinheiro, Boleto, Outro]
      
      Regras:
      1. Extraia o valor (number).
      2. Extraia parcelas (number, default 1). Se disser "3x", são 3 parcelas.
      3. ENQUADRE o item na categoria mais óbvia (Ex: Ifood->Alimentação, Uber->Transporte, Netflix->Lazer).
      
      Retorne APENAS JSON: {"categoria": "String", "valor": Number, "tipoPagamento": "String", "parcelas": Number, "descricao_formatada": "String", "is_gasto": Boolean}
      `;

  try {
    // Chamamos com jsonMode=true, mas a função chamarOpenRouter sabe
    // que só deve enviar o flag especial para o Gemini, evitando erro 400 nos outros.
    let content = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise: "${descricao}"` }
    ], true);

    // Limpeza bruta para garantir que o JSON venha limpo
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) content = jsonMatch[0];
    
    let dados = JSON.parse(content);

    // SANITIZAÇÃO DE CATEGORIA (Correção do "Outro")
    if (dados.categoria) {
        const catIA = dados.categoria.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        
        const categoriaCerta = CATEGORIAS_VALIDAS.find(cat => {
            const catValida = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            return catValida === catIA || catValida.includes(catIA) || catIA.includes(catValida);
        });
        
        dados.categoria = categoriaCerta || "Outro";
    } else {
        dados.categoria = "Outro";
    }

    return dados;

  } catch (error) {
    console.error('Erro Parse JSON IA:', error.message);
    // Fallback limpo para o código principal não quebrar
    return { is_gasto: false, categoria: "Outro" };
  }
}

module.exports = { handlePerguntaIA, analisarGastoComIA };