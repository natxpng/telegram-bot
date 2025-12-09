require('dotenv').config();
const axios = require('axios');
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- 1. LISTA DE MODELOS LIMPA E ROBUSTA ---
const MODELOS_DISPONIVEIS = [
  "google/gemini-2.0-flash-exp:free",      // O mais inteligente
  "google/gemma-2-9b-it:free",             // Rápido e bom em PT-BR
  "meta-llama/llama-3.1-8b-instruct:free", // Estável
  "huggingfaceh4/zephyr-7b-beta:free"      // Backup
];

// --- 2. LISTA DE CATEGORIAS OFICIAIS ---
const CATEGORIAS_VALIDAS = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Educação', 'Compras', 'Dívidas', 'Outro'];

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
        timeout: 60000 
      });
      return response.data.choices?.[0]?.message?.content; 
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * ATENA: CHAT COM ESTRATÉGIA E PERSONALIDADE (SEU PROMPT ORIGINAL)
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
      contextoDados += `Gastos Fixos: R$ ${gastosFixos.toFixed(2)}\n`;
      contextoDados += `Meta de Poupança Mensal: R$ ${metaPoupanca.toFixed(2)}\n`;
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
      contextoDados = "O usuário ainda não finalizou o onboarding. Responda apenas à pergunta dele de forma geral, sem usar dados pessoais. Se ele perguntar sobre os gastos dele, diga que ele precisa se cadastrar com /start primeiro.";
    }

    const systemPrompt = `
    Você é a "Atena", uma estrategista financeira pessoal (e amiga sincera).
    
    **Personalidade:**
    - Feminina, casual, direta e inteligente.
    - Você NÃO é um "fiscal" que proíbe tudo. Você é uma facilitadora.
    - Seu objetivo é fazer o dinheiro da usuária render, permitindo que ela viva bem.

    **REGRAS DE OURO PARA AVALIAR COMPRAS (Use isto para decidir):**

    1. **A Regra do "Cabe no Bolso":**
       - Olhe o "DINHEIRO LIVRE AGORA". Se o valor da compra for MENOR que o dinheiro livre, sua resposta padrão deve ser **SIM**.
       - Ex: "Amiga, tá tranquilo! Você tem caixa pra isso e ainda sobra."

    2. **Avaliação de Timing (Estratégia):**
       - Considere a data de hoje. Se for fim de mês (dia 20+), sugira: "Se você passar no crédito agora, cai só no mês que vem ou já pega essa fatura? Se o cartão virar dia X, compensa esperar 2 dias."
       - Se for início de mês, lembre das prioridades: "O aluguel já tá pago? Se sim, manda bala."

    3. **A Regra da Compensação (Trade-off):**
       - Se o dinheiro estiver curto, mas não impossível, sugira uma TROCA em vez de um "não".
       - Ex: "Dá pra comprar, mas aí a gente precisa segurar a onda no iFood esse fim de semana pra compensar. Topa?"
       - Ex: "Como você já terminou de pagar aquela parcela X (considere se ela mencionar isso), abriu um espaço no orçamento."

    4. **Contexto Emocional:**
       - Se for algo pequeno que traz felicidade (um café, um livro), incentive. Saúde mental importa.
       - Se for algo grande e supérfluo com o orçamento estourado, aí sim alerte com carinho.

    **Formato de Resposta:**
    - Texto curto, direto, sem Markdown, sem enrolação. Use gírias leves ("bora", "tranquilo", "suave").
    - Se for aprovar: "Claro! Tá dentro do orçamento."
    - Se for reprovar: Explique a matemática ("Se comprar isso, falta pro aluguel").
    `;

    let resposta = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: `${contextoDados}\n\nPERGUNTA DO USUÁRIO:\n"${texto}"` }
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

/**
 * FUNÇÃO TÉCNICA: EXTRAÇÃO DE JSON DO GASTO (TURBINADA)
 */
async function analisarGastoComIA(descricao) {
  const systemPrompt = `
      Você é um motor de processamento de despesas. Extraia JSON estrito.
      Categorias Válidas: [Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro]
      Métodos: [Crédito, Débito, Pix, Dinheiro, Boleto, Outro]
      
      Regras:
      1. Extraia o valor (number).
      2. Extraia parcelas (number, default 1). Se disser "3x" ou "3 vezes", são 3 parcelas.
      3. ENQUADRE o item na categoria mais óbvia (Use o bom senso):
         - Mercado, Feira, Ifood, Restaurante, Padaria, Bebida -> Alimentação
         - Uber, 99, Ônibus, Metrô, Gasolina, Estacionamento, Mecânico -> Transporte
         - Cinema, Teatro, Show, Netflix, Spotify, Steam, Jogos, Viagem -> Lazer
         - Farmácia, Médico, Dentista, Exames, Terapia, Academia -> Saúde
         - Aluguel, Condomínio, Luz, Internet, Gás, Reforma -> Moradia
         - Curso, Faculdade, Livro, Material escolar -> Educação
         - Roupas, Eletrônicos, Presentes, Shopee, Shein, Amazon -> Compras
      
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
    
    let dados = JSON.parse(content);

    // --- SANITIZAÇÃO DE CATEGORIA ---
    if (dados.categoria) {
        const categoriaCerta = CATEGORIAS_VALIDAS.find(cat => 
            cat.toLowerCase() === dados.categoria.toLowerCase() || 
            cat.toLowerCase().includes(dados.categoria.toLowerCase()) || 
            dados.categoria.toLowerCase().includes(cat.toLowerCase())
        );
        dados.categoria = categoriaCerta || "Outro";
    } else {
        dados.categoria = "Outro";
    }

    return dados;

  } catch (error) {
    console.error('Erro Parse JSON IA:', error.message);
    return { is_gasto: false, categoria: "Outro" };
  }
}

module.exports = { handlePerguntaIA, analisarGastoComIA };