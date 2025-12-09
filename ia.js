require('dotenv').config();
const axios = require('axios');
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- 1. MODELOS OTIMIZADOS: prioridade + peso + timeout ---
const MODELOS = [
  {
    name: "qwen/qwen2.5-7b-instruct:free",
    priority: 1,
    weight: 5,
    timeout: 8000
  },
  {
    name: "meta-llama/llama-3.1-8b-instruct:free",
    priority: 2,
    weight: 4,
    timeout: 9000
  },
  {
    name: "mistral/mistral-7b-instruct:free",
    priority: 3,
    weight: 3,
    timeout: 9000
  },
  {
    name: "google/gemini-flash-8b:free",
    priority: 4,
    weight: 2,
    timeout: 7000
  },
  {
    name: "openai/gpt-oss-120b:free",
    priority: 5,
    weight: 1,          // só se tudo falhar
    timeout: 5000       // fila vive congestionada → timeout menor
  }
];

// --- 2. LISTA DE CATEGORIAS OFICIAIS ---
const CATEGORIAS_VALIDAS = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Educação', 'Compras', 'Dívidas', 'Outro'];

function expandirPorPeso() {
  const lista = [];
  MODELOS.forEach(m => {
    for (let i = 0; i < m.weight; i++) {
      lista.push(m);
    }
  });
  return lista.sort((a, b) => a.priority - b.priority);
}

// --- 3. FUNÇÃO PRINCIPAL: TIMEOUT INTELIGENTE + FALLBACK ---
async function chamarOpenRouter(messages, jsonMode = false) {
  const modelosOrdenados = expandirPorPeso();
  let erroFinal = null;

  for (const modelo of modelosOrdenados) {
    try {
      console.log(`[IA] Tentando modelo: ${modelo.name} | timeout=${modelo.timeout}ms`);

      const payload = {
        model: modelo.name,
        messages
      };

      // JSON mode ativado só pro Gemini (se você quiser expandir pra Llama depois, me avise)
      if (jsonMode && modelo.name.includes("gemini")) {
        payload.response_format = { type: "json_object" };
      }

      const resp = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        payload,
        {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://telegram-bot.com',
            'X-Title': 'FinanceBot'
          },
          timeout: modelo.timeout
        }
      );

      const conteudo = resp.data.choices?.[0]?.message?.content;
      if (!conteudo) throw new Error("Resposta vazia da IA");

      console.log(`[IA] Modelo OK: ${modelo.name}`);
      return conteudo;

    } catch (err) {
      erroFinal = err;
      console.warn(`[IA] Falha no modelo ${modelo.name}: ${err.message}`);
    }
  }

  throw erroFinal;
}
/**
 * ATENA: PERSONALIDADE + ESTRATÉGIA
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
    - Seu objetivo é fazer o dinheiro da usuária render, permitindo que ela viva bem.

    **REGRAS DE OURO PARA AVALIAR COMPRAS:**
    1. **A Regra do "Cabe no Bolso":**
       - Olhe o "DINHEIRO LIVRE AGORA". Se o valor da compra for MENOR que o dinheiro livre, sua resposta padrão deve ser **SIM**.
       - Ex: "Amiga, tá tranquilo! Você tem caixa pra isso."

    2. **Avaliação de Timing:**
       - Fim de mês? Sugira esperar o cartão virar.
       - Início de mês? Lembre das prioridades (aluguel).

    3. **A Regra da Compensação:**
       - Se o dinheiro estiver curto, sugira uma TROCA.
       - Ex: "Dá pra comprar, mas segura o iFood no fim de semana?"

    **Formato de Resposta:**
    - Texto curto, direto, sem Markdown, sem enrolação. Use gírias leves.
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
 * FUNÇÃO TÉCNICA: EXTRAÇÃO DE JSON DO GASTO (COM LOGS DETALHADOS)
 */
async function analisarGastoComIA(descricao) {
  console.log(`[DEBUG IA] Iniciando análise para: "${descricao}"`);

  const systemPrompt = `
      Você é um motor de processamento de despesas. Extraia JSON estrito.
      
      Categorias Válidas: [Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro]
      Métodos: [Crédito, Débito, Pix, Dinheiro, Boleto, Outro]
      
      Regras:
      1. Extraia o valor (number).
      2. Extraia parcelas (number, default 1). Se disser "3x" ou "3 vezes", são 3 parcelas.
      3. ENQUADRE o item na categoria mais óbvia (Use inteligência):
         - Mercado, Feira, Ifood, Restaurante, Padaria, Bar -> Alimentação
         - Uber, 99, Ônibus, Metrô, Gasolina, Estacionamento, Mecânico -> Transporte
         - Cinema, Teatro, Show, Streaming (Netflix/Spotify), Jogos, Viagem, Passeio -> Lazer
         - Farmácia, Médico, Dentista, Exames, Terapia, Academia, Personal -> Saúde
         - Aluguel, Condomínio, Luz, Internet, Gás, Reforma, Faxina -> Moradia
         - Curso, Faculdade, Livro, Material escolar -> Educação
         - Roupas, Eletrônicos, Presentes, Shopee, Shein, Amazon -> Compras
         - Empréstimo, Cartão atrasado, Juros -> Dívidas
      
      Retorne APENAS JSON: {"categoria": "String", "valor": Number, "tipoPagamento": "String", "parcelas": Number, "descricao_formatada": "String", "is_gasto": Boolean}
      `;

  try {
    let content = await chamarOpenRouter([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise: "${descricao}"` }
    ], true);

    console.log(`[DEBUG IA] Resposta bruta da IA:`, content);

    // --- CORREÇÃO DE PARSING ---
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
        content = content.substring(firstBrace, lastBrace + 1);
    }
    
    let dados = JSON.parse(content);
    console.log(`[DEBUG IA] JSON Parseado:`, dados);

    // --- CORREÇÃO DE CATEGORIA (SANITIZAÇÃO BLINDADA COM LOGS) ---
    if (dados.categoria) {
        const catIA = dados.categoria.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        console.log(`[DEBUG IA] Categoria IA normalizada: "${catIA}"`);
        
        const categoriaCerta = CATEGORIAS_VALIDAS.find(cat => {
            const catValida = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            return catValida === catIA || catValida.includes(catIA) || catIA.includes(catValida);
        });
        
        if (categoriaCerta) {
             console.log(`[DEBUG IA] Match encontrado: "${dados.categoria}" -> "${categoriaCerta}"`);
             dados.categoria = categoriaCerta;
        } else {
             console.log(`[DEBUG IA] Sem match para "${dados.categoria}". Usando fallback "Outro".`);
             dados.categoria = "Outro";
        }
    } else {
        console.log(`[DEBUG IA] Campo categoria vazio. Usando fallback "Outro".`);
        dados.categoria = "Outro";
    }

    return dados;

  } catch (error) {
    console.error('[DEBUG IA] ERRO CRÍTICO NO PARSE/IA:', error.message);
    // Se der erro, retorna zerado para o Regex assumir, mas tenta garantir categoria Outro
    return { is_gasto: false, categoria: "Outro" };
  }
}

module.exports = { handlePerguntaIA, analisarGastoComIA };